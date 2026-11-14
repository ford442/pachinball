/**
 * The vanilla table with no meshes (#528): what the game's builders author into the C++ owner's
 * world, through the same functions (`src/table/table-colliders.ts`), plus the gameplay state the
 * tick reads off `GameObjects` (bumpers, targets, lanes, drain, flippers, plunger).
 *
 * The owner exports the in-scope statics in world creation order, so `buildHeadlessTable` authors
 * them in the order the game's boot does: feeders, the advanced obstacles' zones (and the trap),
 * walls, flippers, the main ball, drain, plunger, lanes, bumpers, slingshots, the pachinko field and
 * the rail colliders. Bodies the game authors that the C++ world never sees and gameplay never
 * reads (ramps, drain rails, the ground slab, the toys' own bodies) are left out: they only take
 * handle numbers. A drift is not silent — the frame-0 snapshot refuses a different static table.
 *
 * Toys and feeders whose state machines still live in mesh-owning classes are stand-ins here that
 * do exactly what the real ones do while idle and hand the run to the `HeadlessGuard` the moment
 * one would engage.
 */

import type { PhysicsApi, PhysicsBody, PhysicsImpulseJoint, PhysicsWorldSink } from '../core/physics-api'
import type { Vec3Like } from '../core/vec3-scalar'
import { GameConfig } from '../config'
import type { FeederKey, TableLayout } from '../cascade/daily-cascade-layout'
import type { BumperRef, PhysicsBinding } from '../game-elements/types'
import { LaneSensorBuilder, type LaneSensorDef } from '../objects/object-lane-sensors'
import {
  gaussCannonCaptureCandidate,
  magSpinCaptureCandidate,
  quantumTunnelCaptureCandidate,
} from '../objects/feeders/feeder-triggers'
import type { BallTrapSim, BallTrapSimState, FeederSim, TableObjectsSim } from '../game/physics/types'
import type { ZoneTriggerSystem } from '../game-elements/zone-trigger-system'
import { TargetBank } from '../table/target-bank'
import {
  authorBallTrapBody,
  authorBumper,
  authorCornerWedge,
  authorDeathZone,
  authorFlipper,
  authorMagSpinPullField,
  authorPachinkoField,
  authorPlungerBody,
  authorQuantumTunnelSensor,
  authorRailColliders,
  authorSlingshot,
  authorWall,
  BUMPER_HOLOGRAM_Y,
  cornerWedgeSpecs,
  FLIPPER_PIVOTS,
  OBSTACLE_ZONE_FOOTPRINTS,
  PLUNGER_REST_Z,
  SLINGSHOT_SPECS,
  TABLE_OBSTACLES,
  tableWallSpecs,
  VANILLA_BUMPERS,
  type BumperSpec,
} from '../table/table-colliders'
import type { HeadlessGuard } from './headless-guard'

const NO_BINDINGS: PhysicsBinding[] = []

/** `GameObjects`' gameplay half: the bodies and state the tick and the input actions read. */
export class HeadlessTable implements TableObjectsSim {
  private readonly targets = new TargetBank(() => GameConfig.gameplay.targetRespawnTime)
  /** Slingshots first, then bumpers (as `GameObjects` keeps them across a rebuild). */
  private bumperRefs: BumperRef[] = []
  private bumperBodies: PhysicsBody[] = []
  /** Bodies of the toys a machine rebuilds (bumpers, pins, the catcher), removed by `rebuildMutableToys`. */
  private mutableBodies: PhysicsBody[] = []
  /** Bodies the game binds to a mesh: walls, wedges, slingshots, rails, bumpers, the pin field. */
  private bound: PhysicsBody[] = []
  private pinBodies: PhysicsBody[] = []
  private railBodies: PhysicsBody[] = []
  private readonly laneSensors: LaneSensorBuilder
  private deathZone: PhysicsBody | null = null
  private plunger: PhysicsBody | null = null
  private readonly flippers = new Map<string, { body: PhysicsBody; joint: PhysicsImpulseJoint }>()

  constructor(
    private readonly world: PhysicsWorldSink,
    private readonly api: PhysicsApi,
  ) {
    this.laneSensors = new LaneSensorBuilder(world, api)
  }

  // ---- Authoring (`buildHeadlessTable` calls these in boot order) ----

  createWalls(): void {
    for (const { pos, size } of tableWallSpecs()) this.bound.push(authorWall(this.world, this.api, pos, size))
    for (const spec of cornerWedgeSpecs()) this.bound.push(authorCornerWedge(this.world, this.api, spec))
  }

  createFlippers(): void {
    const left = authorFlipper(this.world, this.api, FLIPPER_PIVOTS.left, false)
    this.flippers.set('left', { body: left.body, joint: left.joint })
    const right = authorFlipper(this.world, this.api, FLIPPER_PIVOTS.right, true)
    this.flippers.set('right', { body: right.body, joint: right.joint })
  }

  createDeathZone(): void {
    this.deathZone = authorDeathZone(this.world, this.api)
  }

  createPlungerBody(): void {
    this.plunger = authorPlungerBody(this.world, this.api, PLUNGER_REST_Z)
  }

  createLaneSensors(): void {
    this.laneSensors.createLaneSensors()
  }

  createBumpers(specs: readonly BumperSpec[] = VANILLA_BUMPERS): void {
    for (const s of specs) {
      const body = authorBumper(this.world, this.api, s.x, s.z, s.scale)
      this.bumperBodies.push(body)
      this.bumperRefs.push({ body, color: s.color, hologramAnchor: { x: s.x, y: BUMPER_HOLOGRAM_Y, z: s.z } })
      this.bound.push(body)
      this.mutableBodies.push(body)
    }
  }

  createSlingshots(): void {
    for (const { pos, rot } of SLINGSHOT_SPECS) {
      const body = authorSlingshot(this.world, this.api, pos, rot)
      this.bumperBodies.push(body)
      this.bumperRefs.push({ body })
      this.bound.push(body)
    }
  }

  createPachinkoField(layout: TableLayout | null): void {
    const field = layout
      ? authorPachinkoField(this.world, this.api, undefined, undefined, undefined, layout.pins, layout.pinLattice, layout.pinField)
      : authorPachinkoField(this.world, this.api)
    this.pinBodies.push(...field.pinBodies)
    if (field.placements.length > 0 && field.pinBodies[0]) this.bound.push(field.pinBodies[0])
    this.targets.add(field.catchBody)
    this.mutableBodies.push(...field.pinBodies, field.catchBody)
  }

  createRailColliders(): void {
    const rails = authorRailColliders(this.world, this.api)
    this.railBodies = [rails.left, rails.right, rails.leftFlipper, rails.rightFlipper]
    // The cosmetic pass binds the rail meshes to these too (it ran before every golden tape's start).
    this.bound.push(...this.railBodies)
  }

  /** `GameObjects.rebuildMutableToys`: drop the bumpers and pachinko field, build the layout's. */
  rebuildMutableToys(layout: TableLayout | null): void {
    const dropped = new Set(this.mutableBodies)
    for (const body of this.mutableBodies) {
      if (this.world.getRigidBody(body.handle)) this.world.removeRigidBody(body)
    }
    this.mutableBodies = []
    this.bound = this.bound.filter((b) => !dropped.has(b))
    this.bumperRefs = this.bumperRefs.filter((v) => !dropped.has(v.body))
    this.bumperBodies = this.bumperBodies.filter((b) => !dropped.has(b))
    this.pinBodies = []
    this.targets.clear()
    this.createBumpers(layout ? layout.bumpers : VANILLA_BUMPERS)
    this.createPachinkoField(layout)
  }

  // ---- TableObjectsSim ----

  getBindings(): PhysicsBinding[] {
    return NO_BINDINGS
  }

  setBumperState(): void {}

  getBumperBodies(): PhysicsBody[] {
    return this.bumperBodies
  }

  getBumperVisuals(): readonly BumperRef[] {
    return this.bumperRefs
  }

  getAllFlippers(): ReadonlyMap<string, { body: PhysicsBody }> {
    return this.flippers
  }

  updateTargets(dt: number): void {
    this.targets.update(dt)
  }

  updateBumpers(): void {}

  /** `GameObjects.getWasmExportBodies`: the bound bodies, pins, rails, lanes and the drain. */
  getWasmExportBodies(): PhysicsBody[] {
    const bodies = [...this.bound, ...this.pinBodies, ...this.railBodies, ...this.laneSensors.getBodies()]
    if (this.deathZone) bodies.push(this.deathZone)
    return bodies
  }

  getTargetBodies(): PhysicsBody[] {
    return this.targets.bodies
  }

  getLaneSensors(): LaneSensorDef[] {
    return this.laneSensors.getSensors()
  }

  getDeathZoneBody(): PhysicsBody | null {
    return this.deathZone
  }

  deactivateTarget(body: PhysicsBody): boolean {
    return this.targets.deactivate(body) !== -1
  }

  activateBumperHit(): void {}

  resetTargets(): void {
    this.targets.reset()
  }

  // ---- Input actions' view ----

  getFlipperJoints(): { left: PhysicsImpulseJoint | null; right: PhysicsImpulseJoint | null } {
    return { left: this.flippers.get('left')?.joint ?? null, right: this.flippers.get('right')?.joint ?? null }
  }

  getPlungerBody(): PhysicsBody | null {
    return this.plunger
  }

  getPlungerRestZ(): number {
    return PLUNGER_REST_Z
  }
}

// ---------------------------------------------------------------------------
// Toys and feeders: idle as the real ones, fail closed when they would engage
// ---------------------------------------------------------------------------

/** The ball trap: its body is in the C++ world, its catch is the trap builder's state machine. */
export class HeadlessBallTrap implements BallTrapSim {
  readonly state: BallTrapSimState

  constructor(private readonly guard: HeadlessGuard, readonly body: PhysicsBody, color: string) {
    this.state = { body, isOpen: true, caughtBall: null, rearmTimer: 0, trapColor: color }
  }

  getBodies(): PhysicsBody[] {
    return [this.body]
  }

  catchBall(): void {
    this.guard.fail('the ball trap caught a ball')
  }

  /** Idle and open: the real update only decays its rearm timer (and a cosmetic flash). */
  updateTrap(state: BallTrapSimState, dt: number): null {
    if (state.rearmTimer > 0) state.rearmTimer = Math.max(0, state.rearmTimer - dt)
    if (state.caughtBall) this.guard.fail('the ball trap holds a ball')
    return null
  }
}

/** The feeders' shared gameplay switch (`setGameplayEnabled`). */
abstract class HeadlessFeeder implements FeederSim {
  protected gameplayEnabled = true

  constructor(protected readonly guard: HeadlessGuard, protected readonly name: string) {}

  setGameplayEnabled(enabled: boolean): void {
    this.gameplayEnabled = enabled
  }

  update(_dt: number, balls: PhysicsBody[]): void {
    if (!this.gameplayEnabled) return
    if (this.wouldCapture(balls)) this.guard.fail(`the ${this.name} feeder captured a ball`)
  }

  /** The real feeder's idle-state capture test (`feeder-triggers.ts`). */
  protected abstract wouldCapture(balls: readonly PhysicsBody[]): boolean
}

export class HeadlessMagSpin extends HeadlessFeeder {
  private readonly well: Vec3Like

  constructor(guard: HeadlessGuard, private readonly field: PhysicsBody | null, private readonly config = GameConfig.magSpin) {
    super(guard, 'MagSpin')
    this.well = { x: config.feederPosition.x, y: config.feederPosition.y, z: config.feederPosition.z }
  }

  getBodies(): PhysicsBody[] {
    return this.field ? [this.field] : []
  }

  /** The pull field runs while the well is idle and in play (`MagSpinFeeder.syncPullField`). */
  override setGameplayEnabled(enabled: boolean): void {
    super.setGameplayEnabled(enabled)
    if (this.field && this.field.isValid?.() !== false) this.field.setEnabled(enabled)
  }

  protected wouldCapture(balls: readonly PhysicsBody[]): boolean {
    return magSpinCaptureCandidate(balls, this.well, this.config) !== null
  }
}

export class HeadlessGaussCannon extends HeadlessFeeder {
  private readonly position: Vec3Like

  constructor(guard: HeadlessGuard, private readonly config = GameConfig.gaussCannon) {
    super(guard, 'Gauss cannon')
    this.position = { x: config.gaussPosition.x, y: config.gaussPosition.y, z: config.gaussPosition.z }
  }

  protected wouldCapture(balls: readonly PhysicsBody[]): boolean {
    return gaussCannonCaptureCandidate(balls, this.position, this.config) !== null
  }
}

export class HeadlessQuantumTunnel extends HeadlessFeeder {
  constructor(guard: HeadlessGuard, private readonly world: PhysicsWorldSink, private readonly sensor: PhysicsBody) {
    super(guard, 'quantum tunnel')
  }

  override setGameplayEnabled(enabled: boolean): void {
    super.setGameplayEnabled(enabled)
    this.sensor.setEnabled(enabled)
  }

  protected wouldCapture(balls: readonly PhysicsBody[]): boolean {
    return quantumTunnelCaptureCandidate(balls, this.world, this.sensor) !== null
  }
}

/**
 * Nano loom and prism core: their capture logic is not extracted yet, so an enabled one is not
 * replayed — the guard trips on its first step in play.
 */
export class HeadlessOpaqueFeeder extends HeadlessFeeder {
  protected wouldCapture(): boolean {
    return true
  }

  override update(dt: number, balls: PhysicsBody[]): void {
    if (this.gameplayEnabled) this.guard.fail(`the ${this.name} feeder is in play (its gameplay is not extracted from its meshes yet)`)
    super.update(dt, balls)
  }
}

export interface HeadlessFeeders {
  magSpin: HeadlessMagSpin
  nanoLoom: HeadlessOpaqueFeeder
  prismCore: HeadlessOpaqueFeeder
  gaussCannon: HeadlessGaussCannon
  quantumTunnel: HeadlessQuantumTunnel
}

/** `GameDelegates.applyFeederGameplayFlags`: null turns every feeder on. */
export function applyHeadlessFeederFlags(feeders: HeadlessFeeders, flags: Record<FeederKey, boolean> | null): void {
  const allOn = flags === null
  feeders.magSpin.setGameplayEnabled(allOn || !!flags?.magSpin)
  feeders.nanoLoom.setGameplayEnabled(allOn || !!flags?.nanoLoom)
  feeders.prismCore.setGameplayEnabled(allOn || !!flags?.prismCore)
  feeders.gaussCannon.setGameplayEnabled(allOn || !!flags?.gaussCannon)
  feeders.quantumTunnel.setGameplayEnabled(allOn || !!flags?.quantumTunnel)
}

export interface HeadlessTableParts {
  table: HeadlessTable
  feeders: HeadlessFeeders
  trap: HeadlessBallTrap
}

/**
 * Author the boot-time table in the game's creation order (feeders → obstacle zones → scene). The
 * main ball goes in between the flippers and the drain: `createMainBall` runs there in
 * `GameSceneBuilder.buildCriticalScene`.
 */
export function buildHeadlessTable(
  world: PhysicsWorldSink,
  api: PhysicsApi,
  zones: ZoneTriggerSystem,
  guard: HeadlessGuard,
  createMainBall: () => void,
): HeadlessTableParts {
  // Game.setupFeederEventHandlers: MagSpin, nano loom, prism core, Gauss cannon, quantum tunnel.
  // Only MagSpin's pull field reaches C++, and only the quantum tunnel's sensor is read (overlap test).
  const magSpin = new HeadlessMagSpin(guard, authorMagSpinPullField(world, GameConfig.magSpin))
  const nanoLoom = new HeadlessOpaqueFeeder(guard, 'nano loom')
  const prismCore = new HeadlessOpaqueFeeder(guard, 'prism core')
  const gaussCannon = new HeadlessGaussCannon(guard)
  const quantumTunnel = new HeadlessQuantumTunnel(guard, world, authorQuantumTunnelSensor(world, api, GameConfig.quantumTunnel))

  // registerObstacles: spinner, trap, launcher, gate — each footprint a C++ sensor volume. Only the
  // trap's own body is in the C++ world (the others never touch a ball there).
  const o = TABLE_OBSTACLES
  zones.registerObstacleZone('spinner-zone-spinner-0', OBSTACLE_ZONE_FOOTPRINTS.spinner(o.spinner.x, o.spinner.z, o.spinner.scale), { color: o.spinner.color, type: 'spinner' })
  const trapBody = authorBallTrapBody(world, api, o.trap.x, o.trap.z, o.trap.scale)
  zones.registerObstacleZone('trap-zone-trap-0', OBSTACLE_ZONE_FOOTPRINTS.trap(o.trap.x, o.trap.z, o.trap.scale), { color: o.trap.color, type: 'trap' })
  zones.registerObstacleZone('launcher-zone-launcher-0', OBSTACLE_ZONE_FOOTPRINTS.launcher(o.launcher.x, o.launcher.z, o.launcher.scale), { color: o.launcher.color, type: 'launcher' })
  zones.registerObstacleZone('gate-zone-0', OBSTACLE_ZONE_FOOTPRINTS.gate(o.gate.x, o.gate.z, o.gate.scale, o.gate.width, o.gate.height), { color: o.gate.color, type: 'gate' })

  // GameSceneBuilder: critical scene (walls, flippers, main ball), then the gameplay scene.
  const table = new HeadlessTable(world, api)
  table.createWalls()
  table.createFlippers()
  createMainBall()
  table.createDeathZone()
  table.createPlungerBody()
  table.createLaneSensors()
  table.createBumpers()
  table.createSlingshots()
  table.createPachinkoField(null)
  table.createRailColliders()

  return {
    table,
    feeders: { magSpin, nanoLoom, prismCore, gaussCannon, quantumTunnel },
    trap: new HeadlessBallTrap(guard, trapBody, o.trap.color),
  }
}
