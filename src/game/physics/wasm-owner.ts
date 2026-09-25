import type { AdventureColliderDesc } from '../../adventure/track-collider-descriptors'
import type { AdventurePhysicsBridge } from '../../adventure/track-physics-bridge'
import { WASM_PHYSICS, PhysicsConfig, GameConfig } from '../../config'
import type { PhysicsBody } from '../../core/physics-api'
import { getPhysicsTuningValue } from '../../game-elements/physics-tuning'
import { peekPackedPhysicsBuffers, type WasmDebugCollider } from '../../game-elements/wasm-debug-geometry'
import type { InputFrame } from '../../game-elements/types'
import { ContactPhase, decodeContactBuffer } from '../../wasm/contact-buffer'
import type { WasmSimEngine } from '../../wasm/wasm-sim-engine'
import {
  exportAdventureCollidersToWasm,
  type AdventureExportResult,
} from './wasm-adventure-export'
import { composePose, integrateSpin, sphereTouchesVolume, type Pose, type VolumeKind } from './adventure-kinematics'
import { CPP_ALL_GROUPS, WasmBody } from '../../wasm/wasm-body'
import type { WasmContactBridge } from './collision-dispatch'
import {
  driveTableMovers,
  exportTableBodiesToWasm,
  exportedGroups,
  type TableExportResult,
  type UnsupportedTableCollider,
} from './wasm-static-export'
import type { WasmTableWorld } from '../../wasm/wasm-table-world'

const FLIPPER_PROXY_RADIUS = 0.3
const FLIPPER_PROXY_HALF_HEIGHT = 1.55
const FLIPPER_MASS = 2.0

interface PlainQuat { x: number; y: number; z: number; w: number }

export interface AdventureTrackState {
  epoch: number
  descriptors: readonly AdventureColliderDesc[]
  unexported: readonly string[]
  bodyForDescriptor: (index: number) => PhysicsBody | null
}

/** A moving adventure body whose pose TypeScript advances. */
interface AdventureKinematicBody {
  body: PhysicsBody
  /** Prescribed spin; null when the track's animator sets the next pose. */
  angularVelocity: { x: number; y: number; z: number } | null
  movers: { handle: number; local: Pose }[]
  sensors: { local: Pose; kind: VolumeKind; halfExtents: { x: number; y: number; z: number } }[]
}

const CAPSULE_AXIS_TO_BLADE_AXIS: PlainQuat = { x: 0, y: 0, z: -Math.SQRT1_2, w: Math.SQRT1_2 }
const BLADE_AXIS_TO_CAPSULE_AXIS: PlainQuat = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }

interface FlipperHinge {
  body: WasmBody
  wasmId: number
  hingeId: number
  isRight: boolean
  debug: WasmDebugCollider
}

/**
 * WasmOwner — the C++ engine owns the table and adventure tracks (#412).
 *
 * Bodies come from `WasmTableWorld`, not Rapier: balls are C++ rigid bodies
 * from birth, flippers are realised here as hinged capsules, and every other
 * collider the builders authored is exported from its descriptor
 * (`wasm-static-export.ts`, `wasm-adventure-export.ts`). Contacts resolve
 * straight from WASM public ids to those bodies (`resolveContactId`), which is
 * the id space `CollisionDispatcher` keys its sets on in owner mode.
 */
export class WasmOwner implements WasmContactBridge {
  private readonly engine: WasmSimEngine
  private readonly world: WasmTableWorld
  private flippers: FlipperHinge[] = []
  /** Table bodies the owner exports; see `GameObjects.getWasmExportBodies()`. */
  private tableScope: () => Iterable<PhysicsBody> = () => []
  private tableExport: TableExportResult | null = null
  /** Bodies with colliders that were left out of the C++ world, and why. */
  private outOfScope: UnsupportedTableCollider[] = []
  private exportedRevision = -1
  /** Bumped whenever the WASM id → body map changes; CollisionDispatcher rebuilds on a change. */
  private idEpoch = 0
  private adventureTrack: AdventureTrackState | null = null
  private adventureEpoch = -1
  private adventureExport: AdventureExportResult | null = null
  private adventureKinematics: AdventureKinematicBody[] = []
  private adventureBodyById = new Map<number, PhysicsBody>()
  private adventureIdsByBody = new Map<PhysicsBody, number[]>()
  private sensorBodyByHandle = new Map<number, PhysicsBody>()
  private sensorHandlesByBody = new Map<PhysicsBody, number[]>()
  private sensorOverlaps = new Set<string>()
  private leftPressed = false
  private rightPressed = false
  private leftHoldTime = 0
  private rightHoldTime = 0

  constructor(engine: WasmSimEngine, world: WasmTableWorld) {
    this.engine = engine
    this.world = world
    world.setListener({
      groupsChanged: (body) => this.reapplyGroups(body),
      bodyRemoved: (body) => this.onBodyRemoved(body),
    })
  }

  // ---- Table ------------------------------------------------------------

  /** Choose which table bodies the C++ world simulates. Evaluated on every export. */
  setTableScope(scope: () => Iterable<PhysicsBody>): void {
    this.tableScope = scope
    this.exportedRevision = -1
  }

  /**
   * Realise the flipper hinges and (re-)export the static scene if the
   * table changed. Idempotent: balls already live in C++, a flipper already
   * hinged keeps its C++ body, and an unchanged table is not re-exported.
   */
  rebuild(flipperBodies: readonly PhysicsBody[], adventure: AdventureTrackState | null = this.adventureTrack): void {
    const wanted = new Set(flipperBodies)
    for (const f of [...this.flippers]) {
      if (!wanted.has(f.body)) this.removeFlipper(f)
    }
    for (const body of flipperBodies) {
      if (body instanceof WasmBody && !this.flippers.some((f) => f.body === body)) this.realizeFlipper(body)
    }
    this.syncAdventureTrack(adventure)
    this.syncStatics()
  }

  /** Re-export the static scene when a builder added, removed, moved or retyped a table body. */
  syncStatics(): void {
    if (this.exportedRevision === this.world.structureRevision && this.tableExport) return
    this.exportStaticScene()
  }

  /**
   * Changes each time WASM ids are (re)assigned — a static re-export, a
   * flipper hinge, a ball spawned or removed — so the dispatcher's sets
   * refresh even when a spawner never calls rebuildHandleCaches().
   */
  getIdEpoch(): number {
    return this.idEpoch + this.world.linkRevision
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
   * Before the C++ step: pin held bodies, push table kinematic bodies (the
   * plunger, moving gates) and every moving adventure body to their movers.
   */
  beginStep(dt: number): void {
    this.world.beginStep()
    if (this.tableExport) driveTableMovers(this.tableExport.movers, this.engine)
    this.driveAdventure(dt)
  }

  /** After the C++ step: commit kinematic poses and track sensor overlaps. */
  endStep(): void {
    this.world.endStep()
    this.refreshSensorOverlaps()
  }

  // ---- Contact id space (CollisionDispatcher) -----------------------------

  /** WASM public id a body is dispatched under: its C++ body id, else its first exported collider. */
  keyOf(body: PhysicsBody): number | null {
    if (body instanceof WasmBody && body.link) return body.link.id
    const ids = (body instanceof WasmBody ? this.tableExport?.idsByBody.get(body) : undefined)
      ?? this.adventureIdsByBody.get(body)
    return ids && ids.length > 0 ? ids[0] : null
  }

  /** Map a WASM public id from a contact to its body and dispatch key. */
  resolveContactId(wasmId: number): { body: PhysicsBody; key: number } | null {
    const body = wasmId >= 0
      ? this.world.bodyForLinkedId(wasmId)
      : (this.tableExport?.bodyById.get(wasmId) ?? this.adventureBodyById.get(wasmId) ?? null)
    if (!body) return null
    const key = this.keyOf(body)
    return key === null ? null : { body, key }
  }

  // ---- Adventure --------------------------------------------------------

  /**
   * Advance every moving adventure body by `dt` and push its colliders' poses
   * into the C++ movers. Animated obstacles have their next pose set by
   * AdventureMode's animator; spinning platters and mills are integrated here
   * from their prescribed angular velocity.
   */
  driveAdventure(dt: number): void {
    if (!this.isAdventureOwned()) return
    for (const k of this.adventureKinematics) {
      const pose = this.advanceKinematicBody(k, dt)
      for (const mover of k.movers) {
        const world = composePose(pose, mover.local)
        this.engine.setNextKinematicTransform(mover.handle, world.position, world.rotation)
      }
    }
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
        const ballId = ball instanceof WasmBody ? ball.wasmId : null
        if (ballId === null) return false
        const handles = this.sensorHandlesByBody.get(sensorBody)
        if (handles?.some((handle) => this.sensorOverlaps.has(`${handle}:${ballId}`))) return true
        return this.touchesMovingSensor(sensorBody, ballId)
      },
      applyImpulse: (ball, x, y, z) => ball.applyImpulse({ x, y, z }, true),
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
    if (!this.adventureTrack && this.adventureBodyById.size === 0) return
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

  /**
   * Table colliders the C++ world is not simulating — shapes it cannot
   * represent, and bodies outside the table scope — each with a reason.
   * Nothing is silently dropped.
   */
  getTableUnsupported(): readonly UnsupportedTableCollider[] {
    return [...(this.tableExport?.unsupported ?? []), ...this.outOfScope]
  }

  getAdventureDebugColliders(): readonly WasmDebugCollider[] {
    return this.adventureExport?.debug ?? []
  }

  getDebugColliders(): WasmDebugCollider[] {
    const balls: WasmDebugCollider[] = []
    for (const body of this.world.allBodies()) {
      const link = body.link
      if (!link?.owned) continue
      const shape = body.colliders[0]?.desc.shape
      if (shape?.kind !== 'sphere') continue
      const t = body.translation()
      balls.push({ kind: 'sphere', center: { x: t.x, y: t.y, z: t.z }, radius: shape.radius, bodyId: link.id })
    }
    return [
      ...(this.tableExport?.debug ?? []),
      ...this.flippers.map((f) => f.debug),
      ...balls,
      ...(this.adventureExport?.debug ?? []),
    ]
  }

  dispose(): void {
    for (const f of [...this.flippers]) this.removeFlipper(f)
    this.world.setListener(null)
    this.adventureTrack = null
    this.tableExport = null
    this.adventureExport = null
  }

  // ---- Internals --------------------------------------------------------

  private realizeFlipper(body: WasmBody): void {
    const pivot = body.translation()
    const com = body.numColliders() > 0 ? body.collider(0).translation() : pivot
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
    if (id < 0) return
    const q = CAPSULE_AXIS_TO_BLADE_AXIS
    this.engine.setBodyRotation(id, q.x, q.y, q.z, q.w)
    const hingeId = this.engine.createHinge({
      bodyId: id,
      worldAnchor: { x: pivot.x, y: pivot.y, z: pivot.z },
      worldAxis: { x: 0, y: 1, z: 0 },
      minAngle: limits[0],
      maxAngle: limits[1],
    })
    // The authored body keeps reporting its pivot and blade frame, as its Rapier body did.
    this.world.linkBody(body, {
      id,
      pivot: { x: pivot.x, y: pivot.y, z: pivot.z },
      rotationOffset: BLADE_AXIS_TO_CAPSULE_AXIS,
      mass: FLIPPER_MASS,
      owned: false,
    })
    this.flippers.push({
      body,
      wasmId: id,
      hingeId,
      isRight,
      debug: {
        kind: 'capsule',
        center: { x: com.x, y: com.y, z: com.z },
        radius: FLIPPER_PROXY_RADIUS,
        halfHeight: FLIPPER_PROXY_HALF_HEIGHT,
        rotation: { ...CAPSULE_AXIS_TO_BLADE_AXIS },
        bodyId: id,
      },
    })
    this.idEpoch++
  }

  private removeFlipper(f: FlipperHinge): void {
    this.engine.removeHinge(f.hingeId)
    this.engine.removeBody(f.wasmId)
    this.world.unlinkBody(f.body)
    this.flippers = this.flippers.filter((other) => other !== f)
    this.idEpoch++
  }

  private onBodyRemoved(body: WasmBody): void {
    const flipper = this.flippers.find((f) => f.body === body)
    if (flipper) this.removeFlipper(flipper)
  }

  /** Apply an enable / collision-group change to a body's already-exported ids. */
  private reapplyGroups(body: WasmBody): void {
    const exported = this.tableExport
    const ids = exported?.idsByBody.get(body)
    if (!exported || !ids) return
    for (const id of ids) {
      const collider = exported.colliderById.get(id)
      if (!collider) continue
      const groups = exportedGroups(body, collider) ?? { membership: CPP_ALL_GROUPS, filter: CPP_ALL_GROUPS }
      this.engine.setCollisionGroups(id, groups.membership, groups.filter)
    }
  }

  private adventureBodies(): Set<PhysicsBody> {
    const bodies = new Set<PhysicsBody>()
    const track = this.adventureTrack
    if (!track) return bodies
    for (let i = 0; i < track.descriptors.length; i++) {
      const body = track.bodyForDescriptor(i)
      if (body) bodies.add(body)
    }
    return bodies
  }

  private exportStaticScene(): void {
    this.engine.clearStaticGeometry?.()
    const plane = WASM_PHYSICS.tunables.groundPlane
    this.engine.addStaticPlane({ x: plane.normal.x, y: plane.normal.y, z: plane.normal.z }, plane.distance, plane.friction)
    // Adventure bodies live in the same world but export from their track descriptors.
    const adventure = this.adventureBodies()
    const scope = new Set(this.tableScope())
    const table: WasmBody[] = []
    this.outOfScope = []
    for (const body of this.world.allBodies()) {
      if (adventure.has(body) || body.link) continue
      if (scope.has(body)) {
        table.push(body)
        continue
      }
      body.colliders.forEach((collider, colliderIndex) => {
        this.outOfScope.push({
          bodyHandle: body.handle,
          colliderIndex,
          shape: collider.desc.shape.kind,
          reason: 'outside the owner table scope',
        })
      })
    }
    this.tableExport = exportTableBodiesToWasm(table, this.engine)
    this.exportedRevision = this.world.structureRevision
    this.exportAdventureGeometry()
    this.idEpoch++
  }

  private exportAdventureGeometry(): void {
    this.adventureKinematics = []
    this.adventureExport = null
    this.adventureBodyById.clear()
    this.adventureIdsByBody.clear()
    this.sensorBodyByHandle.clear()
    this.sensorHandlesByBody.clear()
    this.sensorOverlaps.clear()

    const track = this.adventureTrack
    if (!track) return

    const result = exportAdventureCollidersToWasm(track.descriptors, this.engine)
    this.adventureExport = result

    for (const [index, handle] of result.handles) {
      const body = track.bodyForDescriptor(index)
      if (!body) continue
      this.adventureBodyById.set(handle, body)
      const ids = this.adventureIdsByBody.get(body)
      if (ids) ids.push(handle)
      else this.adventureIdsByBody.set(body, [handle])

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
  private touchesMovingSensor(sensorBody: PhysicsBody, ballId: number): boolean {
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
}
