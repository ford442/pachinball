/**
 * Table colliders — the physics half of the vanilla table's builders, with no Babylon import.
 *
 * Each function authors exactly the bodies and colliders its builder used to author inline, with
 * the same descriptors, values and call order (a body's C++ handle follows authoring order, and
 * the frame-0 snapshot / static hash pin both). The builders in `src/objects/` call these and then
 * build their meshes around the bodies returned; the headless replay runner (#528,
 * `src/sim/headless-table.ts`) calls the same functions with no meshes at all.
 *
 * Rotations go through `quatFromEulerAngles`, Babylon's `Quaternion.FromEulerAngles` arithmetic,
 * so the authored bits are identical with or without the renderer loaded.
 */

import { supportsAxisPullFields, supportsPinFields, type PhysicsApi, type PhysicsBody, type PhysicsImpulseJoint, type PhysicsRevoluteJoint, type PhysicsWorldSink } from '../core/physics-api'
import { resolvePinField } from '../core/pin-field'
import type { PinLattice, SeededPinField } from '../cascade/daily-cascade-layout'
import {
  PEG_COLLIDER_RADIUS,
  PEG_FRICTION,
  PEG_HEIGHT,
  PEG_RESTITUTION,
  PIN_Y,
  pachinkoPinFieldSpec,
  pinInKeepOut,
} from '../objects/pachinko-pin-field'
import { COLLISION_GROUP_PRESETS } from '../core/collision-groups'
import { quatFromEulerAngles } from '../core/pose-math'
import type { Vec3Like } from '../core/vec3-scalar'
import { GameConfig, PhysicsConfig, type GameConfigType } from '../config'
import { getPhysicsTuningValue } from '../game-elements/physics-tuning'

type Sink = PhysicsWorldSink
type Api = PhysicsApi

// ---------------------------------------------------------------------------
// Walls, wedges, slingshots
// ---------------------------------------------------------------------------

/** A straight wall: a fixed box `size.x × 2·size.y × size.z` centred on `pos` (size.y is the half height). */
export function authorWall(world: Sink, api: Api, pos: Vec3Like, size: Vec3Like): PhysicsBody {
  const b = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
  world.createCollider(
    api.ColliderDesc.cuboid(size.x / 2, size.y, size.z / 2)
      .setFriction(GameConfig.ball.friction)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
    b,
  )
  return b
}

/** The outer walls, the plunger base and the lane guide, in authoring order (`WallBuilder.createWalls`). */
export function tableWallSpecs(): Array<{ pos: Vec3Like; size: Vec3Like }> {
  const wallH = GameConfig.table.wallHeight
  return [
    // 1. Outer walls (left, right, top)
    { pos: { x: -10, y: wallH, z: 5 }, size: { x: 0.2, y: 5, z: 32 } },
    { pos: { x: 11.5, y: wallH, z: 5 }, size: { x: 0.2, y: 5, z: 32 } },
    { pos: { x: 0.75, y: wallH, z: 20.5 }, size: { x: 22.5, y: 5, z: 1.0 } },
    // 2. Drain / plunger base
    { pos: { x: 10.5, y: wallH, z: -10.5 }, size: { x: 1.9, y: 5, z: 1.0 } },
    // 3. Shortened plunger lane guide
    {
      pos: { x: 9.5, y: wallH, z: GameConfig.table.laneGuideZ },
      size: { x: 0.2, y: 5, z: GameConfig.table.laneGuideLength },
    },
  ]
}

export interface WedgeSpec {
  name: string
  x: number
  z: number
  rotationY: number
  /** Box width along the diagonal. */
  diagWidth: number
  height: number
  thickness: number
}

/** The two top corner wedges (`WallBuilder.createCornerWedges`). */
export function cornerWedgeSpecs(height: number = GameConfig.table.wallHeight): WedgeSpec[] {
  const wedgeSize = GameConfig.table.wedgeSize
  const thickness = GameConfig.table.wedgeThickness
  const diagWidth = Math.sqrt(2 * (wedgeSize * wedgeSize))
  return [
    { name: 'wedgeTL', x: -10 + (wedgeSize / 2), z: 20.5 - (wedgeSize / 2), rotationY: -Math.PI / 4, diagWidth, height, thickness },
    { name: 'wedgeTR', x: 11.5 - (wedgeSize / 2), z: 20.5 - (wedgeSize / 2), rotationY: Math.PI / 4, diagWidth, height, thickness },
  ]
}

export function authorCornerWedge(world: Sink, api: Api, w: WedgeSpec): PhysicsBody {
  const q = quatFromEulerAngles(0, w.rotationY, 0)
  const body = world.createRigidBody(
    api.RigidBodyDesc.fixed()
      .setTranslation(w.x, 1, w.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  )
  world.createCollider(
    api.ColliderDesc.cuboid(w.diagWidth / 2, w.height / 2, w.thickness / 2)
      .setRestitution(0.5)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
    body,
  )
  return body
}

/** Left and right slingshots: position and yaw (`WallBuilder.createSlingshots`). */
export const SLINGSHOT_SPECS: ReadonlyArray<{ pos: Vec3Like; rot: number }> = [
  { pos: { x: -6.5, y: 0, z: -3 }, rot: -Math.PI / 6 },
  { pos: { x: 6.5, y: 0, z: -3 }, rot: Math.PI / 6 },
]

export function authorSlingshot(world: Sink, api: Api, pos: Vec3Like, rot: number): PhysicsBody {
  const q = quatFromEulerAngles(0, rot, 0)
  const b = world.createRigidBody(
    api.RigidBodyDesc.fixed()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
  )
  world.createCollider(
    api.ColliderDesc.cuboid(0.25, 1, 2)
      .setRestitution(1.5)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.BUMPER)
      .setActiveEvents(api.ActiveEvents.COLLISION_EVENTS),
    b,
  )
  return b
}

// ---------------------------------------------------------------------------
// Flippers
// ---------------------------------------------------------------------------

export const FLIPPER_LENGTH = 3.5
/** Left and right flipper pivots (`FlipperBuilder.createFlippers`). */
export const FLIPPER_PIVOTS: Readonly<Record<'left' | 'right', Vec3Like>> = {
  // Slightly above the LCD deck (y=-1) so paddles clear the tilted playfield
  // after reparenting + mesh interpolation (y=-0.5 still z-fought the surface).
  left: { x: -4, y: -0.25, z: -7 },
  right: { x: 4, y: -0.25, z: -7 },
}

export interface AuthoredFlipper {
  body: PhysicsBody
  anchor: PhysicsBody
  joint: PhysicsRevoluteJoint
}

/** One flipper: the dynamic blade (box + tip ball), its fixed anchor and the limited revolute joint. */
export function authorFlipper(world: Sink, api: Api, pos: Vec3Like, isRight: boolean): AuthoredFlipper {
  const flipperLength = FLIPPER_LENGTH
  const body = world.createRigidBody(
    api.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0.5)
      .setAngularDamping(2)
      .setCcdEnabled(true),
  )

  // Main blade collider (box)
  const colliderOffset = isRight ? (flipperLength - 0.4) / 2 : -(flipperLength - 0.4) / 2
  const bladeTilt = quatFromEulerAngles(0.15, 0, 0)
  world.createCollider(
    api.ColliderDesc.cuboid((flipperLength - 0.4) / 2, 0.3, 0.25)
      .setTranslation(colliderOffset, 0, 0)
      .setRotation({ x: bladeTilt.x, y: bladeTilt.y, z: bladeTilt.z, w: bladeTilt.w })
      .setRestitution(PhysicsConfig.flipper.restitution)
      .setFriction(PhysicsConfig.flipper.friction)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.FLIPPER),
    body,
  )

  // Rounded tip collider (ball)
  const tipOffset = isRight ? flipperLength - 0.3 : -(flipperLength - 0.3)
  world.createCollider(
    api.ColliderDesc.ball(0.3)
      .setTranslation(tipOffset, 0.05, 0)
      .setRestitution(PhysicsConfig.flipper.restitution)
      .setFriction(PhysicsConfig.flipper.friction)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.FLIPPER),
    body,
  )

  const anchor = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))

  const pX = isRight ? 1.5 : -1.5
  const jParams = api.JointData.revolute(
    new api.Vector3(pX, 0, 0),
    new api.Vector3(pX, 0, 0),
    new api.Vector3(0, 1, 0),
  )
  jParams.limitsEnabled = true
  jParams.limits = isRight ? [-Math.PI / 4, Math.PI / 6] : [-Math.PI / 6, Math.PI / 4]

  const joint = world.createImpulseJoint(jParams, anchor, body, true) as PhysicsRevoluteJoint
  joint.configureMotorPosition(
    isRight ? -PhysicsConfig.flipper.restAngleRad : PhysicsConfig.flipper.restAngleRad,
    PhysicsConfig.flipper.stiffness,
    PhysicsConfig.flipper.damping,
  )
  return { body, anchor, joint }
}

// ---------------------------------------------------------------------------
// Drain, plunger, lane-area rails
// ---------------------------------------------------------------------------

export function authorDeathZone(world: Sink, api: Api): PhysicsBody {
  const body = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(0, -2, -14))
  world.createCollider(
    api.ColliderDesc.cuboid(20, 2, 2)
      .setSensor(true)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.SENSOR)
      .setActiveEvents(api.ActiveEvents.COLLISION_EVENTS),
    body,
  )
  return body
}

/** Plunger tip rest z: just behind the ball spawn (the ball spawns at z = -9). */
export const PLUNGER_REST_Z = -9.8

/** The kinematic plunger the input actions drive (not exported to C++: the launch is an impulse). */
export function authorPlungerBody(world: Sink, api: Api, restZ: number = PLUNGER_REST_Z): PhysicsBody {
  const body = world.createRigidBody(api.RigidBodyDesc.kinematicPositionBased().setTranslation(10.5, 0.5, restZ))
  world.createCollider(
    api.ColliderDesc.cuboid(0.3, 0.3, 0.4)
      .setRestitution(0.9)
      .setFriction(0.1)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
    body,
  )
  return body
}

/**
 * A side or flipper-area rail collider (`DecorationBuilder.createRailColliders`): a fixed box,
 * yawed by `2·halfYaw` when given.
 */
export function authorRailCollider(
  world: Sink, api: Api,
  px: number, py: number, pz: number,
  hx: number, hy: number, hz: number,
  restitution: number,
  halfYaw?: number,
): PhysicsBody {
  const placed = api.RigidBodyDesc.fixed().setTranslation(px, py, pz)
  const desc = halfYaw === undefined
    ? placed
    : placed.setRotation(new api.Quaternion(0, Math.sin(halfYaw), 0, Math.cos(halfYaw)))
  const body = world.createRigidBody(desc)
  world.createCollider(
    api.ColliderDesc.cuboid(hx, hy, hz)
      .setRestitution(restitution)
      .setFriction(0.1)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
    body,
  )
  return body
}

export interface RailColliders {
  left: PhysicsBody
  right: PhysicsBody
  leftFlipper: PhysicsBody
  rightFlipper: PhysicsBody
}

/** The four rail colliders the ball plays against, in authoring order. */
export function authorRailColliders(world: Sink, api: Api): RailColliders {
  return {
    left: authorRailCollider(world, api, -11.8, 0.8, 5, 0.6, 1.2, 16, 0.5),
    right: authorRailCollider(world, api, 12.8, 0.8, 5, 0.6, 1.2, 16, 0.5),
    leftFlipper: authorRailCollider(world, api, -7, 0.3, -8, 0.3, 0.6, 4, 0.4, -0.15),
    rightFlipper: authorRailCollider(world, api, 8.5, 0.3, -8, 0.3, 0.6, 4, 0.4, 0.15),
  }
}

// ---------------------------------------------------------------------------
// Bumpers
// ---------------------------------------------------------------------------

export interface BumperSpec {
  x: number
  z: number
  color: string
  scale: number
}

/** The vanilla table's bumpers, all left of the launch corridor (`KEEP_OUT_BOXES.launchLane`, x 8.5–12). */
export const VANILLA_BUMPERS: readonly BumperSpec[] = [
  // Main center bumper (larger)
  { x: 0, z: 8, color: '#ff00aa', scale: 1.2 },
  // Upper side bumpers
  { x: -4, z: 4, color: '#00aaff', scale: 1.0 },
  { x: 3.5, z: 4, color: '#00aaff', scale: 1.0 },
  // Lower bumpers - funnel toward flippers
  { x: -3, z: 0, color: '#ffaa00', scale: 0.9 },
  { x: 3, z: 0, color: '#ffaa00', scale: 0.9 },
  // Far upper bumper
  { x: 0, z: 14, color: '#00ff88', scale: 0.85 },
  // Side deflector bumper (left only — right side is the plunger corridor)
  { x: -6, z: 10, color: '#ff4400', scale: 1.0 },
  // Additional scoring bumpers — stay left of the launch corridor
  { x: 0, z: 2, color: '#88ffaa', scale: 0.85 },
  { x: -5, z: 6, color: '#ffaa88', scale: 0.9 },
  { x: 3.5, z: 7, color: '#ffaa88', scale: 0.9 },
  // Lower sides near slings to catch outlane recoveries
  { x: -4, z: -1, color: '#aaffff', scale: 0.8 },
  { x: 3.5, z: -1, color: '#aaffff', scale: 0.8 },
]

/** Height of a bumper's hologram pillar centre: where a hologram catch holds the ball. */
export const BUMPER_HOLOGRAM_Y = 1.8

/** A bumper: the scoring ball collider and the tall hologram sensor above it. */
export function authorBumper(world: Sink, api: Api, x: number, z: number, scale: number = 1.0): PhysicsBody {
  const body = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(x, 0.5, z))

  world.createCollider(
    api.ColliderDesc.ball(0.4 * scale)
      .setRestitution(getPhysicsTuningValue('bumperRestitution'))
      .setFriction(PhysicsConfig.surfaces.bumper.friction)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.BUMPER)
      .setActiveEvents(api.ActiveEvents.COLLISION_EVENTS),
    body,
  )

  world.createCollider(
    api.ColliderDesc.cylinder(1.5, 0.5)
      .setSensor(true)
      .setTranslation(0, 2.0, 0)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.SENSOR)
      .setActiveEvents(api.ActiveEvents.COLLISION_EVENTS),
    body,
  )
  return body
}

// ---------------------------------------------------------------------------
// Ball trap (the one toy the C++ owner simulates)
// ---------------------------------------------------------------------------

/** The trap's funnel cone and its chamber sensor, centred at (x, 0.5, z). */
export function authorBallTrapBody(world: Sink, api: Api, x: number, z: number, scale: number = 1.0): PhysicsBody {
  const body = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(x, 0.5, z))

  // Trap entrance collision (funnel)
  world.createCollider(
    api.ColliderDesc.cone(0.6 * scale, 0.2)
      .setRestitution(0.6)
      .setFriction(0.3)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.TARGET)
      .setActiveEvents(api.ActiveEvents.COLLISION_EVENTS),
    body,
  )

  // Trap chamber sensor (catches ball)
  world.createCollider(
    api.ColliderDesc.ball(0.45 * scale)
      .setTranslation(0, -0.3 * scale, 0)
      .setSensor(true)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.SENSOR)
      .setActiveEvents(api.ActiveEvents.COLLISION_EVENTS),
    body,
  )
  return body
}

/** Zone footprints the advanced obstacles register with `ZoneTriggerSystem`, around (x, z). */
export const OBSTACLE_ZONE_FOOTPRINTS = {
  spinner: (x: number, z: number, scale: number) => ({
    minX: x - 0.7 * scale, maxX: x + 0.7 * scale, minZ: z - 0.7 * scale, maxZ: z + 0.7 * scale, minY: 0, maxY: 1.0 * scale,
  }),
  trap: (x: number, z: number, scale: number) => ({
    minX: x - 0.65 * scale, maxX: x + 0.65 * scale, minZ: z - 0.65 * scale, maxZ: z + 0.65 * scale, minY: 0, maxY: 1.0 * scale,
  }),
  launcher: (x: number, z: number, scale: number) => ({
    minX: x - 0.35 * scale, maxX: x + 0.35 * scale, minZ: z - 0.25 * scale, maxZ: z + 0.25 * scale, minY: 0, maxY: 1.0 * scale,
  }),
  gate: (x: number, z: number, scale: number, width: number, height: number) => ({
    minX: x - (width * scale) / 2, maxX: x + (width * scale) / 2, minZ: z - 0.15 * scale, maxZ: z + 0.15 * scale, minY: 0, maxY: height * scale,
  }),
} as const

/** The four advanced obstacles `registerObstacles` places on every table, in registration order. */
export const TABLE_OBSTACLES = {
  spinner: { x: 5, z: 10, color: '#00ffff', scale: 1.0 },
  trap: { x: -5, z: 10, color: '#ff00ff', scale: 1.0 },
  launcher: { x: 2, z: 16, color: '#00ff88', scale: 1.0 },
  gate: { x: -2, z: 16, color: '#ffaa00', scale: 1.0, animation: 'slide' as const, width: 2.0, height: 1.5 },
} as const

export type { PhysicsImpulseJoint }

// ---------------------------------------------------------------------------
// Pachinko field
// ---------------------------------------------------------------------------

/** Where the vanilla pachinko field sits and how big it is (`PachinkoBuilder.createPachinkoField`). */
export const PACHINKO_FIELD = { center: { x: 0, y: 0.5, z: 6 }, width: 24, height: 22 } as const

export interface AuthoredPachinkoField {
  /** Every pin, as the resolver places it (or the off-lattice seeded positions). */
  placements: Array<{ x: number; z: number }>
  /** Every pin collider's body: the one pin-field body when the sink supports fields, else one per pin. */
  pinBodies: PhysicsBody[]
  /** The catcher in the field's centre: a target sensor. */
  catchBody: PhysicsBody
}

/**
 * The pachinko pins and the central catcher. On a sink with pin fields (the C++ owner) the whole
 * lattice is one body; elsewhere every pin is its own fixed cylinder.
 */
export function authorPachinkoField(
  world: Sink,
  api: Api,
  center: Vec3Like = PACHINKO_FIELD.center,
  width: number = PACHINKO_FIELD.width,
  height: number = PACHINKO_FIELD.height,
  pinPositions?: { x: number; z: number }[],
  pinLattice?: PinLattice,
  seededField?: SeededPinField,
): AuthoredPachinkoField {
  const pinBodies: PhysicsBody[] = []
  // One PinFieldSpec for the whole lattice: the C++ owner resolves it into pins, and the visual
  // instances come from the same resolver either way, so they sit exactly on the pins that collide.
  const spec = pachinkoPinFieldSpec(center, width, height, pinPositions, pinLattice, seededField)
  const placements = spec
    ? resolvePinField(spec).map((pin) => ({ x: pin.position.x, z: pin.position.z }))
    : (pinPositions ?? []).filter((p) => !pinInKeepOut(p.x, p.z)).map((p) => ({ x: p.x, z: p.z }))

  let fieldBody: PhysicsBody | null = null
  if (spec && supportsPinFields(world)) {
    fieldBody = world.createPinField(spec)
    pinBodies.push(fieldBody)
  }

  // The Rapier path (and off-lattice seeded pins) still need a body per pin.
  if (!fieldBody) {
    for (const { x, z } of placements) {
      const body = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(x, PIN_Y, z))
      world.createCollider(
        api.ColliderDesc.cylinder(PEG_HEIGHT / 2, PEG_COLLIDER_RADIUS)
          .setRestitution(PEG_RESTITUTION)
          .setFriction(PEG_FRICTION)
          .setCollisionGroups(COLLISION_GROUP_PRESETS.WALL),
        body,
      )
      pinBodies.push(body)
    }
  }

  // Catcher in the center of the pachinko field
  const catchBody = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(center.x, 0.2, center.z))
  world.createCollider(
    api.ColliderDesc.cylinder(0.5, 1.0)
      .setSensor(true)
      .setCollisionGroups(COLLISION_GROUP_PRESETS.SENSOR)
      .setActiveEvents(api.ActiveEvents.COLLISION_EVENTS),
    catchBody,
  )
  return { placements, pinBodies, catchBody }
}

// ---------------------------------------------------------------------------
// MagSpin well
// ---------------------------------------------------------------------------

/**
 * MagSpin's well on the C++ owner: one vertical axis-pull field at the feeder position (the
 * engine draws idle-state balls in). Null when the sink has no fields (Rapier): the feeder then
 * authors its Rapier-era bowl itself.
 */
export function authorMagSpinPullField(world: Sink, config: GameConfigType['magSpin']): PhysicsBody | null {
  if (!supportsAxisPullFields(world)) return null
  const p = config.feederPosition
  return world.createAxisPullField({
    center: { x: p.x, y: p.y, z: p.z },
    radius: config.pullRadius,
    halfHeight: config.pullHalfHeight,
    strength: config.pullAcceleration,
    acceleration: true,
  })
}

// ---------------------------------------------------------------------------
// Quantum tunnel input sensor
// ---------------------------------------------------------------------------

/**
 * The quantum tunnel's input portal: a fixed sphere sensor at `inputPosition`. Not exported to the
 * C++ world — the feeder asks the world sink whether a ball overlaps it (`intersectionPair`).
 */
export function authorQuantumTunnelSensor(world: Sink, api: Api, config: GameConfigType['quantumTunnel']): PhysicsBody {
  const pos = config.inputPosition
  const body = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z))
  world.createCollider(
    api.ColliderDesc.ball(config.inputRadius)
      .setSensor(true)
      .setActiveEvents(api.ActiveEvents.COLLISION_EVENTS),
    body,
  )
  return body
}
