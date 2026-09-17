import type * as RAPIER from '@dimforge/rapier3d-compat'

import type { AdventureColliderDesc } from '../../adventure/track-collider-descriptors'
import type { AdventurePhysicsBridge } from '../../adventure/track-physics-bridge'
import { WASM_PHYSICS, PhysicsConfig, GameConfig } from '../../config'
import { getPhysicsTuningValue } from '../../game-elements/physics-tuning'
import { peekPackedPhysicsBuffers, type WasmDebugCollider } from '../../game-elements/wasm-debug-geometry'
import type { BumperVisual, InputFrame, PhysicsBinding } from '../../game-elements/types'
import { ContactPhase, decodeContactBuffer } from '../../wasm/contact-buffer'
import type { WasmSimEngine } from '../../wasm/wasm-sim-engine'
import {
  exportAdventureCollidersToWasm,
  type AdventureExportResult,
} from './wasm-adventure-export'
import { composePose, integrateSpin, sphereTouchesVolume, type Pose, type VolumeKind } from './adventure-kinematics'
import { exportRapierBodyToWasm } from './wasm-static-export'

const FLIPPER_PROXY_RADIUS = 0.3
const FLIPPER_PROXY_HALF_HEIGHT = 1.55
const FLIPPER_MASS = 2.0

interface PlainQuat { x: number; y: number; z: number; w: number }

export interface AdventureTrackState {
  epoch: number
  descriptors: readonly AdventureColliderDesc[]
  unexported: readonly string[]
  bodyForDescriptor: (index: number) => RAPIER.RigidBody | null
}

/** A moving adventure body whose pose TypeScript advances (no Rapier step). */
interface AdventureKinematicBody {
  body: RAPIER.RigidBody
  /** Prescribed spin; null when the track's animator sets the next pose. */
  angularVelocity: { x: number; y: number; z: number } | null
  movers: { handle: number; local: Pose }[]
  sensors: { local: Pose; kind: VolumeKind; halfExtents: { x: number; y: number; z: number } }[]
}

const CAPSULE_AXIS_TO_BLADE_AXIS: PlainQuat = { x: 0, y: 0, z: -Math.SQRT1_2, w: Math.SQRT1_2 }
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

export class WasmOwner {
  private engine: WasmSimEngine
  private rapierToWasm = new Map<RAPIER.RigidBody, number>()
  private wasmToRapier = new Map<number, RAPIER.RigidBody>()
  private bumperWasmIds = new Set<number>()
  private ballBodies = new Set<RAPIER.RigidBody>()
  private flippers: FlipperHinge[] = []
  private disabledRapierBodies = new Set<RAPIER.RigidBody>()
  private dynamicDebug: WasmDebugCollider[] = []
  private tableStaticBindings: PhysicsBinding[] = []
  private tableStaticDebug: WasmDebugCollider[] = []
  private adventureTrack: AdventureTrackState | null = null
  private adventureEpoch = -1
  private adventureExport: AdventureExportResult | null = null
  private adventureKinematics: AdventureKinematicBody[] = []
  private adventureDebug: WasmDebugCollider[] = []
  private adventureWasmIds: number[] = []
  private sensorBodyByHandle = new Map<number, RAPIER.RigidBody>()
  private sensorHandlesByBody = new Map<RAPIER.RigidBody, number[]>()
  private sensorOverlaps = new Set<string>()
  private leftPressed = false
  private rightPressed = false
  private leftHoldTime = 0
  private rightHoldTime = 0

  constructor(engine: WasmSimEngine) {
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
    this.dynamicDebug = []
    this.tableStaticBindings = []
    this.tableStaticDebug = []
    this.adventureTrack = null
    this.adventureEpoch = -1
    this.adventureExport = null
    this.adventureKinematics = []
    this.adventureDebug = []
    this.adventureWasmIds = []
    this.sensorBodyByHandle.clear()
    this.sensorHandlesByBody.clear()
    this.sensorOverlaps.clear()
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

    const flipperSet = new Set(flipperBodies)
    const bumperSet = new Set(bumperBodies)
    const ballSet = new Set(ballBodies)

    this.tableStaticBindings = staticBindings.filter((binding) => {
      const body = binding.rigidBody
      return !flipperSet.has(body) && !bumperSet.has(body) && !ballSet.has(body)
    })
    this.exportStaticScene()

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
        bodyType: 2,
      })
      this.track(body, id)
      this.bumperWasmIds.add(id)
      const t = body.translation()
      this.dynamicDebug.push({ kind: 'sphere', center: { x: t.x, y: t.y, z: t.z }, radius, bodyId: id })
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
      const t = body.translation()
      this.dynamicDebug.push({ kind: 'sphere', center: { x: t.x, y: t.y, z: t.z }, radius: GameConfig.ball.radius, bodyId: id })
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
        CAPSULE_AXIS_TO_BLADE_AXIS.w,
      )
      const hingeId = this.engine.createHinge({
        bodyId: id,
        worldAnchor: { x: pivot.x, y: pivot.y, z: pivot.z },
        worldAxis: { x: 0, y: 1, z: 0 },
        minAngle: limits[0],
        maxAngle: limits[1],
      })

      this.wasmToRapier.set(id, body)
      this.flippers.push({ rapierBody: body, wasmId: id, hingeId, isRight, anchor: { x: pivot.x, y: pivot.y, z: pivot.z } })
      this.dynamicDebug.push({
        kind: 'capsule',
        center: { x: com.x, y: com.y, z: com.z },
        radius: FLIPPER_PROXY_RADIUS,
        halfHeight: FLIPPER_PROXY_HALF_HEIGHT,
        rotation: { ...CAPSULE_AXIS_TO_BLADE_AXIS },
        bodyId: id,
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

  driveFlippers(frame: InputFrame | null, dt: number): void {
    if (frame) {
      if (frame.flipperLeft !== null) this.leftPressed = frame.flipperLeft
      if (frame.flipperRight !== null) this.rightPressed = frame.flipperRight
    }
    this.leftHoldTime = this.leftPressed ? this.leftHoldTime + dt : 0
    this.rightHoldTime = this.rightPressed ? this.rightHoldTime + dt : 0

    for (const f of this.flippers) {
      const pressed = f.isRight ? this.rightPressed : this.leftPressed
      const hold = f.isRight ? this.rightHoldTime : this.leftHoldTime
      const holdFactor = Math.min(hold / PhysicsConfig.flipper.holdTimeDivisor, 1)
      const stiffness = getPhysicsTuningValue('flipperStiffness') * (pressed ? 1 + holdFactor * 0.3 : 0.8)
      const damping = getPhysicsTuningValue('flipperDamping') * (pressed ? 0.9 + holdFactor * 0.1 : 1.1)
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

  /**
   * Advance every moving adventure body by `dt` and push its colliders' poses
   * into the C++ movers.
   *
   * Animated obstacles (pistons, oscillators, swinging arms) have their next
   * pose set by AdventureMode's animator; spinning platters and mills are
   * integrated here from their prescribed angular velocity. Either way the
   * pose is computed in TypeScript — Rapier is never stepped for it. The
   * Rapier body only stores the committed pose, which the mesh bindings and
   * the Rapier fallback read.
   */
  driveAdventure(dt: number): void {
    // Unowned tracks step Rapier, which integrates these bodies itself.
    if (!this.isAdventureOwned() || !this.engine.setNextKinematicTransform) return
    for (const k of this.adventureKinematics) {
      const pose = this.advanceKinematicBody(k, dt)
      for (const mover of k.movers) {
        const world = composePose(pose, mover.local)
        this.engine.setNextKinematicTransform(mover.handle, world.position, world.rotation)
      }
    }
  }

  applyBallImpulse(rapierBody: RAPIER.RigidBody, ix: number, iy: number, iz: number): void {
    const id = this.rapierToWasm.get(rapierBody)
    if (id !== undefined) this.engine.applyImpulse(id, ix, iy, iz)
  }

  refreshSensorOverlaps(): void {
    if (!this.isAdventureOwned() || this.sensorBodyByHandle.size === 0) return
    const packed = peekPackedPhysicsBuffers(this.engine)
    if (!packed.contacts || packed.contactCount <= 0) return

    for (const evt of decodeContactBuffer(packed.contacts, packed.contactCount)) {
      if (!evt.isSensor || !this.sensorBodyByHandle.has(evt.bodyId2)) continue
      const key = `${evt.bodyId2}:${evt.bodyId1}`
      if (evt.phase === ContactPhase.Exit) this.sensorOverlaps.delete(key)
      else this.sensorOverlaps.add(key)
    }
  }

  getPhysicsBridge(): AdventurePhysicsBridge {
    return {
      overlaps: (sensorBody, ball) => {
        const ballId = this.rapierToWasm.get(ball)
        if (ballId === undefined) return false
        const handles = this.sensorHandlesByBody.get(sensorBody)
        if (handles?.some((handle) => this.sensorOverlaps.has(`${handle}:${ballId}`))) return true
        return this.touchesMovingSensor(sensorBody, ballId)
      },
      applyImpulse: (ball, x, y, z) => this.applyBallImpulse(ball, x, y, z),
    }
  }

  syncFromWasm(rapier: typeof RAPIER | null): void {
    if (!rapier || !this.engine.hasTransformSnapshot()) return
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
      f.rapierBody.setRotation({ x: rapierRot.x, y: rapierRot.y, z: rapierRot.z, w: rapierRot.w }, true)
      f.rapierBody.setAngvel(new rapier.Vector3(ang.x, ang.y, ang.z), true)
      f.rapierBody.setLinvel(new rapier.Vector3(0, 0, 0), true)
    }
  }

  syncAdventureTrack(state: AdventureTrackState | null): boolean {
    const changed = (state?.epoch ?? -1) !== this.adventureEpoch || (state === null) !== (this.adventureTrack === null)
    if (changed) {
      this.adventureTrack = state
      this.adventureEpoch = state?.epoch ?? -1
      this.exportStaticScene()
    }
    if (!state) return true
    return this.isAdventureOwned()
  }

  clearAdventureTrack(): void {
    if (!this.adventureTrack && this.adventureWasmIds.length === 0) return
    this.adventureTrack = null
    this.adventureEpoch = -1
    this.exportStaticScene()
  }

  isAdventureOwned(): boolean {
    if (!this.adventureTrack) return false
    if (this.adventureTrack.unexported.length > 0) return false
    return this.adventureExport !== null && this.adventureExport.unsupported.length === 0
  }

  getAdventureUnsupported(): readonly { reason: string; index?: number; label?: string }[] {
    const unsupported = this.adventureExport?.unsupported ?? []
    const unexported = this.adventureTrack?.unexported.map((label) => ({
      reason: 'built outside the descriptor export path',
      label,
    })) ?? []
    return [...unsupported, ...unexported]
  }

  getAdventureDebugColliders(): readonly WasmDebugCollider[] {
    return this.adventureDebug
  }

  getDebugColliders(): WasmDebugCollider[] {
    return [...this.tableStaticDebug, ...this.dynamicDebug, ...this.adventureDebug]
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

  private exportStaticScene(): void {
    this.engine.clearStaticGeometry?.()
    const plane = WASM_PHYSICS.tunables.groundPlane
    this.engine.addStaticPlane({ x: plane.normal.x, y: plane.normal.y, z: plane.normal.z }, plane.distance, plane.friction)
    this.tableStaticDebug = []
    for (const binding of this.tableStaticBindings) {
      this.tableStaticDebug.push(...exportRapierBodyToWasm(binding.rigidBody, this.engine))
    }
    this.exportAdventureGeometry()
  }

  private exportAdventureGeometry(): void {
    for (const wasmId of this.adventureWasmIds) {
      this.wasmToRapier.delete(wasmId)
    }
    this.adventureWasmIds = []
    this.adventureKinematics = []
    this.adventureDebug = []
    this.adventureExport = null
    this.sensorBodyByHandle.clear()
    this.sensorHandlesByBody.clear()
    this.sensorOverlaps.clear()

    const track = this.adventureTrack
    if (!track) return

    const result = exportAdventureCollidersToWasm(track.descriptors, this.engine)
    this.adventureExport = result
    this.adventureDebug = result.debug

    for (const [index, handle] of result.handles) {
      const body = track.bodyForDescriptor(index)
      if (!body) continue
      this.wasmToRapier.set(handle, body)
      this.adventureWasmIds.push(handle)

      if (track.descriptors[index]?.sensor) {
        this.sensorBodyByHandle.set(handle, body)
        const handles = this.sensorHandlesByBody.get(body)
        if (handles) handles.push(handle)
        else this.sensorHandlesByBody.set(body, [handle])
      }
    }

    const kinematicByIndex = new Map<number, AdventureKinematicBody>()
    for (const { bodyIndex, angularVelocity } of result.kinematicBodies) {
      const body = track.bodyForDescriptor(bodyIndex)
      if (!body) continue
      const entry: AdventureKinematicBody = { body, angularVelocity, movers: [], sensors: [] }
      kinematicByIndex.set(bodyIndex, entry)
      this.adventureKinematics.push(entry)
    }
    for (const mover of result.movers) {
      kinematicByIndex.get(mover.bodyIndex)?.movers.push({ handle: mover.handle, local: mover.local })
    }
    for (const sensor of result.movingSensors) {
      kinematicByIndex.get(sensor.bodyIndex)?.sensors.push(sensor)
    }
  }

  /** Commit a moving body's pose for this tick and return it. */
  private advanceKinematicBody(k: AdventureKinematicBody, dt: number): Pose {
    const { body } = k
    let position: Pose['position']
    let rotation: Pose['rotation']
    if (k.angularVelocity) {
      const t = body.translation()
      const r = body.rotation()
      position = { x: t.x, y: t.y, z: t.z }
      rotation = integrateSpin({ x: r.x, y: r.y, z: r.z, w: r.w }, k.angularVelocity, dt)
    } else {
      const t = body.nextTranslation()
      const r = body.nextRotation()
      position = { x: t.x, y: t.y, z: t.z }
      rotation = { x: r.x, y: r.y, z: r.z, w: r.w }
    }
    body.setTranslation(position, false)
    body.setRotation(rotation, false)
    return { position, rotation }
  }

  /** Analytic overlap for sensors riding on a moving body (no C++ sensor exists for them). */
  private touchesMovingSensor(sensorBody: RAPIER.RigidBody, ballId: number): boolean {
    const k = this.adventureKinematics.find((entry) => entry.body === sensorBody)
    if (!k || k.sensors.length === 0) return false
    const center = this.engine.getPosition(ballId)
    const t = sensorBody.translation()
    const r = sensorBody.rotation()
    const bodyPose: Pose = { position: { x: t.x, y: t.y, z: t.z }, rotation: { x: r.x, y: r.y, z: r.z, w: r.w } }
    return k.sensors.some((sensor) =>
      sphereTouchesVolume(center, GameConfig.ball.radius, sensor.kind, sensor.halfExtents, composePose(bodyPose, sensor.local))
    )
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
