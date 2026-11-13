/**
 * The element segments of the track schema (#505 §A): what the hand-written
 * TS track modules built inline — seeded scatters, explicit obstacles and
 * kinematic movers, parts riding a spinner, pin rows, decor.
 *
 * Every placement is the same chain of Babylon vector operations the TS
 * modules used (`anchor.add(fwd.scale(a)).add(right.scale(l))`, then `y +=`
 * each lift), and every seeded number is `min + r * (max - min)` from one
 * `getLayoutRng(seedKey)` stream drawn in a fixed order, so a converted track
 * emits bit-identical colliders (tests/track-element-parity.test.ts).
 *
 * Builds through `TrackBuilderApi` only.
 */

import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { getLayoutRng, type SeededRng } from '../core/seeded-rng'
import type { PhysicsBody } from '../core/physics-api'
import { GROUP_BLUE, GROUP_GREEN, GROUP_RED, MASK_ALL, type AnimatedObstacle } from './adventure-types'
import type { TrackBuilderApi, TrackMaterial } from './track-builder-api'
import {
  boxDesc,
  convexMeshDesc,
  cylinderDesc,
  sphereDesc,
  type AdventureColliderDesc,
  type DescOptions,
} from './track-collider-descriptors'
import type { EmittedCollider } from './track-collider-emitter'
import { triangularPrismLayout } from './track-geometry'
import type {
  ArcPylonSegment,
  DecorSegment,
  MaterialRef,
  MeshShapeSpec,
  MotionSpec,
  NumberSpec,
  ObstacleItemSpec,
  ObstacleSegment,
  PinRowsSegment,
  Placement,
  ScatterSegment,
  ShapeSpec,
  SpinnerPartsSegment,
  VisualMeshSpec,
  ZoneSpec,
} from '../schemas/track'

/** The most recent spinner: what spinner parts attach to and `from: "spinner"` measures from. */
export interface SpinnerAnchor {
  center: Vector3
  heading: number
  radius: number
  angVel: number
  body: PhysicsBody
  mesh: Mesh
}

export interface CursorMark {
  pos: Vector3
  heading: number
}

/** Cursor state the element segments read (a subset of `TrackCursor`). */
export interface ElementCursor {
  pos: Vector3
  heading: number
  lastRampStart?: Vector3
  lastInclineRad?: number
  lastRampLength?: number
  lastRampHeading?: number
  lastRampWidth?: number
  lastSpinner?: SpinnerAnchor
}

/** Per-compile state shared by every segment. */
export interface ElementContext {
  api: TrackBuilderApi
  cursor: ElementCursor
  marks: Map<string, CursorMark>
  /** One stream per seed key for the whole compile, created on first use. */
  streams: Map<string, SeededRng>
  /** Material for a ref (role, `#hex`, `pbr:#hex`); undefined → the track default. */
  material(ref: MaterialRef | undefined): TrackMaterial
}

/** One full turn in radians, as the TS modules wrote it. */
const TURN = Math.PI * 2

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function forward(heading: number): Vector3 {
  return new Vector3(Math.sin(heading), 0, Math.cos(heading))
}

function rightOf(heading: number): Vector3 {
  return new Vector3(Math.cos(heading), 0, -Math.sin(heading))
}

/** Unit vector down a ramp's surface (heading 0 → (0, -sin, cos)). */
export function rampForward(heading: number, inclineRad: number): Vector3 {
  const horiz = forward(heading)
  return new Vector3(horiz.x * Math.cos(inclineRad), -Math.sin(inclineRad), horiz.z * Math.cos(inclineRad))
}

/** Ramp surface normal (heading 0 → (0, cos, sin)). */
export function rampNormal(heading: number, inclineRad: number): Vector3 {
  const horiz = forward(heading)
  return new Vector3(horiz.x * Math.sin(inclineRad), Math.cos(inclineRad), horiz.z * Math.sin(inclineRad))
}

function stream(ctx: ElementContext, key: string): SeededRng {
  let rng = ctx.streams.get(key)
  if (!rng) {
    rng = getLayoutRng(key)
    ctx.streams.set(key, rng)
  }
  return rng
}

/** Evaluate a number spec for element `index`; a seeded one draws from `rng`. */
function numberOf(spec: NumberSpec, index: number, rng: SeededRng | null): number {
  if (typeof spec === 'number') return spec
  if ('start' in spec) return spec.start + index * spec.step
  if (!rng) throw new Error('a { random } value needs a seedKey')
  const [min, max] = spec.random
  const value = min + rng.next() * (max - min)
  return spec.scale !== undefined ? value * spec.scale : value
}

/** Index k of `n` variants: how many of 1/n, 2/n, … the draw exceeds (two → `r > 0.5`). */
function variantIndex(n: number, r: number): number {
  let k = 0
  for (let j = 1; j < n; j++) if (r > j / n) k++
  return k
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

interface Anchor {
  base: Vector3
  heading: number
}

function rampAnchor(cursor: ElementCursor): { start: Vector3; heading: number; incline: number; length: number } {
  return {
    start: cursor.lastRampStart ?? cursor.pos,
    heading: cursor.lastRampHeading ?? cursor.heading,
    incline: cursor.lastInclineRad ?? 0,
    length: cursor.lastRampLength ?? 0,
  }
}

function anchorOf(ctx: ElementContext, from: Placement['from'], mark: string | undefined): Anchor {
  const { cursor } = ctx
  if (mark !== undefined) {
    const m = ctx.marks.get(mark)
    if (!m) throw new Error(`no mark named ${mark}`)
    return { base: m.pos, heading: m.heading }
  }
  switch (from ?? 'cursor') {
    case 'cursor':
      return { base: cursor.pos, heading: cursor.heading }
    case 'rampStart': {
      const ramp = rampAnchor(cursor)
      return { base: ramp.start, heading: ramp.heading }
    }
    case 'rampCenter': {
      const ramp = rampAnchor(cursor)
      const hLen = ramp.length * Math.cos(ramp.incline)
      const vDrop = ramp.length * Math.sin(ramp.incline)
      const base = ramp.start.add(forward(ramp.heading).scale(hLen / 2))
      base.y -= vDrop / 2
      return { base, heading: ramp.heading }
    }
    case 'spinner': {
      const spinner = cursor.lastSpinner
      if (!spinner) throw new Error('no spinner to measure from')
      return { base: spinner.center, heading: spinner.heading }
    }
  }
}

interface Placed {
  pos: Vector3
  heading: number
}

/** Resolve a placement: offset, along, lateral, normal (surface frame), then each lift. Never aliases the anchor. */
export function placementPoint(ctx: ElementContext, at: Placement | undefined): Placed {
  const anchor = anchorOf(ctx, at?.from, at?.mark)
  return { pos: stepFrom(ctx, anchor, at ?? {}), heading: anchor.heading }
}

function stepFrom(
  ctx: ElementContext,
  anchor: Anchor,
  steps: { frame?: 'flat' | 'surface'; offset?: { x: number; y: number; z: number }; along?: number; lateral?: number; normal?: number; up?: readonly number[] },
): Vector3 {
  const surface = steps.frame === 'surface'
  const ramp = rampAnchor(ctx.cursor)
  let p = anchor.base
  if (steps.offset) p = p.add(new Vector3(steps.offset.x, steps.offset.y, steps.offset.z))
  if (steps.along !== undefined) {
    const fwd = surface ? rampForward(anchor.heading, ramp.incline) : forward(anchor.heading)
    p = p.add(fwd.scale(steps.along))
  }
  if (steps.lateral !== undefined) p = p.add(rightOf(anchor.heading).scale(steps.lateral))
  if (steps.normal !== undefined) p = p.add(rampNormal(anchor.heading, ramp.incline).scale(steps.normal))
  if (p === anchor.base) p = anchor.base.clone()
  for (const lift of steps.up ?? []) p.y += lift
  return p
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function dim(value: number | 'size', size: number | undefined): number {
  if (value !== 'size') return value
  if (size === undefined) throw new Error('a "size" dimension needs the scatter size')
  return size
}

/** Half of the shape's height: what `seat` lifts it by. */
function seatHeight(shape: ShapeSpec, size: number | undefined): number {
  switch (shape.kind) {
    case 'box':
      return shape.size === 'size' ? dim('size', size) / 2 : shape.size.y / 2
    case 'cylinder':
    case 'prism':
      return dim(shape.height, size) / 2
    case 'sphere':
      return dim(shape.diameter, size) / 2
    case 'tetra':
      return dim(shape.size, size) / 2
  }
}

function colliderOf(shape: ShapeSpec, size: number | undefined, pos: { x: number; y: number; z: number }, opts: DescOptions): AdventureColliderDesc {
  const at = { x: pos.x, y: pos.y, z: pos.z }
  switch (shape.kind) {
    case 'box': {
      if (shape.size === 'size') {
        const s = dim('size', size)
        return boxDesc(at, { x: s / 2, y: s / 2, z: s / 2 }, opts)
      }
      return boxDesc(at, { x: shape.size.x / 2, y: shape.size.y / 2, z: shape.size.z / 2 }, opts)
    }
    case 'cylinder':
      return cylinderDesc(at, dim(shape.height, size) / 2, dim(shape.diameter, size) / 2, opts)
    case 'sphere':
      return sphereDesc(at, dim(shape.diameter, size) / 2, opts)
    case 'prism':
      return convexMeshDesc(at, triangularPrismLayout(dim(shape.diameter, size) / 2, dim(shape.height, size)), opts)
    case 'tetra': {
      const third = dim(shape.size, size) / 3
      return boxDesc(at, { x: third, y: third, z: third }, opts)
    }
  }
}

/** The mesh matching a collider shape. */
function meshOfShape(ctx: ElementContext, shape: ShapeSpec, size: number | undefined, name: string): Mesh {
  const { scene } = ctx.api
  switch (shape.kind) {
    case 'box':
      if (shape.size === 'size') return MeshBuilder.CreateBox(name, { size: dim('size', size) }, scene)
      return MeshBuilder.CreateBox(name, { width: shape.size.x, height: shape.size.y, depth: shape.size.z }, scene)
    case 'cylinder':
      return MeshBuilder.CreateCylinder(name, { diameter: dim(shape.diameter, size), height: dim(shape.height, size) }, scene)
    case 'sphere':
      return MeshBuilder.CreateSphere(name, { diameter: dim(shape.diameter, size) }, scene)
    case 'prism':
      return MeshBuilder.CreateCylinder(name, { diameter: dim(shape.diameter, size), height: dim(shape.height, size), tessellation: 3 }, scene)
    case 'tetra':
      return MeshBuilder.CreatePolyhedron(name, { type: 0, size: dim(shape.size, size) * 0.6 }, scene)
  }
}

function meshOfMeshShape(ctx: ElementContext, shape: MeshShapeSpec, name: string): Mesh {
  const { scene } = ctx.api
  switch (shape.kind) {
    case 'box':
      return MeshBuilder.CreateBox(name, { width: shape.size.x, height: shape.size.y, depth: shape.size.z }, scene)
    case 'cylinder':
      return MeshBuilder.CreateCylinder(
        name,
        shape.tessellation !== undefined
          ? { diameter: shape.diameter, height: shape.height, tessellation: shape.tessellation }
          : { diameter: shape.diameter, height: shape.height },
        scene,
      )
    case 'sphere':
      return MeshBuilder.CreateSphere(name, { diameter: shape.diameter }, scene)
    case 'torus':
      return MeshBuilder.CreateTorus(
        name,
        shape.tessellation !== undefined
          ? { diameter: shape.diameter, thickness: shape.thickness, tessellation: shape.tessellation }
          : { diameter: shape.diameter, thickness: shape.thickness },
        scene,
      )
    case 'tetra':
      return MeshBuilder.CreatePolyhedron(name, { type: 0, size: shape.size }, scene)
  }
}

/** Custom visuals: the first mesh at `pos`, the rest its children at their `local`. */
function buildVisuals(ctx: ElementContext, visuals: readonly VisualMeshSpec[], pos: Vector3, fallback: MaterialRef | undefined, name: string): Mesh {
  let root: Mesh | null = null
  for (const visual of visuals) {
    const mesh = meshOfMeshShape(ctx, visual.shape, name)
    mesh.material = ctx.material(visual.material ?? fallback)
    if (!root) {
      mesh.position.copyFrom(pos)
      root = mesh
      continue
    }
    mesh.parent = root
    const local = visual.local ?? { x: 0, y: 0, z: 0 }
    mesh.position.set(local.x, local.y, local.z)
  }
  if (!root) throw new Error('a visual list needs at least one mesh')
  return root
}

const COLLISION_GROUPS = { RED: GROUP_RED, GREEN: GROUP_GREEN, BLUE: GROUP_BLUE } as const

// ---------------------------------------------------------------------------
// One element (a scatter copy or an obstacle item)
// ---------------------------------------------------------------------------

/** An element with every group default applied. */
type ElementSpec = Omit<ObstacleItemSpec, 'at'>

interface ElementBuild {
  spec: ElementSpec
  shape: ShapeSpec
  pos: Vector3
  heading: number
  size?: number
  /** Euler angles from a scatter `rotation` (x, y, z), when it has one. */
  euler?: { x: number; y: number; z: number }
  /** Motion numbers already drawn. */
  motion?: { frequency: number; amplitude: number; phase: number }
  name: string
}

function orientation(ctx: ElementContext, spec: ElementSpec, heading: number, euler: ElementBuild['euler']): { x: number; y: number; z: number } | null {
  if (euler) return euler
  if (spec.orient === 'heading') return { x: 0, y: heading, z: 0 }
  if (spec.orient === 'ramp') {
    const ramp = rampAnchor(ctx.cursor)
    return { x: ramp.incline, y: ramp.heading, z: 0 }
  }
  return null
}

function buildElement(ctx: ElementContext, el: ElementBuild): void {
  const { api } = ctx
  const { spec, shape, pos } = el
  const angles = orientation(ctx, spec, el.heading, el.euler)
  const isZone = spec.zone !== undefined
  const meshOption = spec.mesh ?? (isZone ? false : undefined)

  let mesh: Mesh | null = null
  if (meshOption !== false) {
    mesh = Array.isArray(meshOption)
      ? buildVisuals(ctx, meshOption, pos, spec.material, el.name)
      : meshOfShape(ctx, shape, el.size, el.name)
    if (!Array.isArray(meshOption)) {
      mesh.position.copyFrom(pos)
      mesh.material = ctx.material(spec.material)
    }
    if (angles) {
      if (spec.orient === 'ramp' || el.euler) mesh.rotation.x = angles.x
      mesh.rotation.y = angles.y
      if (el.euler) mesh.rotation.z = angles.z
    }
    api.adventureTrack.push(mesh)
  }

  const opts: DescOptions = {}
  if (angles) {
    const q = Quaternion.FromEulerAngles(angles.x, angles.y, angles.z)
    opts.rotation = { x: q.x, y: q.y, z: q.z, w: q.w }
  }
  if (spec.restitution !== undefined) opts.restitution = spec.restitution
  if (spec.friction !== undefined) opts.friction = spec.friction
  if (spec.collisionColor !== undefined) {
    opts.membership = COLLISION_GROUPS[spec.collisionColor]
    opts.filter = MASK_ALL
  }
  if (spec.sensor === true || isZone) opts.sensor = true
  if (spec.motion) opts.motion = 'kinematic-position'
  if (spec.label !== undefined) opts.label = spec.label
  if (spec.local) opts.localPosition = { x: spec.local.x, y: spec.local.y, z: spec.local.z }

  const { body } = api.emitCollider(colliderOf(shape, el.size, pos, opts))

  if (spec.zone) {
    addZone(ctx, spec.zone, body)
    return
  }
  api.adventureBodies.push(body)
  if (spec.motion && el.motion) {
    if (!mesh) throw new Error(`${el.name}: a mover needs a mesh`)
    if (spec.motion.bindMesh === true) api.kinematicBindings.push({ body, mesh })
    api.animatedObstacles.push(animated(spec.motion, el.motion, body, mesh, pos, el.heading))
  }
}

function addZone(ctx: ElementContext, zone: ZoneSpec, sensor: PhysicsBody): void {
  switch (zone.kind) {
    case 'conveyor':
      ctx.api.conveyorZones.push({ sensor, force: new Vector3(zone.force.x, zone.force.y, zone.force.z) })
      return
    case 'rampConveyor': {
      const ramp = rampAnchor(ctx.cursor)
      ctx.api.conveyorZones.push({ sensor, force: rampForward(ramp.heading, ramp.incline).scale(zone.force) })
      return
    }
    case 'damping':
      ctx.api.dampingZones.push({ sensor, damping: zone.damping })
      return
  }
}

function animated(
  motion: MotionSpec,
  values: { frequency: number; amplitude: number; phase: number },
  body: PhysicsBody,
  mesh: Mesh,
  basePos: Vector3,
  heading: number,
): AnimatedObstacle {
  const axis = motion.axis === 'right' ? rightOf(heading) : motion.axis ? new Vector3(motion.axis.x, motion.axis.y, motion.axis.z) : undefined
  switch (motion.kind) {
    case 'oscillator':
      return { body, mesh, type: 'OSCILLATOR', basePos, frequency: values.frequency, amplitude: values.amplitude, phase: values.phase, ...(axis ? { axis } : {}) }
    case 'rotatingOscillator':
      return {
        body,
        mesh,
        type: 'ROTATING_OSCILLATOR',
        basePos,
        baseRot: new Quaternion(),
        frequency: values.frequency,
        amplitude: values.amplitude,
        phase: values.phase,
        axis: axis ?? new Vector3(0, 1, 0),
      }
    default:
      return { body, mesh, type: 'PISTON', basePos, frequency: values.frequency, amplitude: values.amplitude, phase: values.phase }
  }
}

const MOTION_NUMBERS = ['frequency', 'amplitude', 'phase'] as const

/** Draw / evaluate a motion's numbers for element `index`: the `draw` keys first, in that order, then the rest. */
function motionNumbers(motion: MotionSpec, index: number, rng: SeededRng | null): { frequency: number; amplitude: number; phase: number } {
  const out = { frequency: 0, amplitude: 0, phase: 0 }
  const first = motion.draw ?? []
  const order = [...first, ...MOTION_NUMBERS.filter((key) => !first.includes(key))]
  for (const key of order) {
    const spec = motion[key]
    if (spec !== undefined) out[key] = numberOf(spec, index, rng)
  }
  return out
}

function mergeMotion(group: MotionSpec | undefined, item: MotionSpec | undefined): MotionSpec | undefined {
  if (!group) return item
  if (!item) return group
  return { ...group, ...item }
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export function buildScatter(ctx: ElementContext, seg: ScatterSegment): void {
  if (!ctx.api.hasWorld) return
  const rng = stream(ctx, seg.seedKey)
  const anchor = anchorOf(ctx, seg.mark === undefined ? (seg.from ?? 'rampStart') : undefined, seg.mark)
  const surface = seg.frame === 'surface'
  const ramp = rampAnchor(ctx.cursor)
  for (let i = 0; i < seg.count; i++) {
    const along = numberOf(seg.along, i, rng)
    const lateral = seg.lateral !== undefined ? numberOf(seg.lateral, i, rng) : undefined
    const shape = seg.shapes ? seg.shapes[variantIndex(seg.shapes.length, rng.next())] : seg.shape
    if (!shape) throw new Error('scatter needs a shape')
    const size = seg.size ? seg.size[0] + rng.next() * (seg.size[1] - seg.size[0]) : undefined
    let euler: ElementBuild['euler']
    if (seg.rotation) {
      const turn = (spec: NumberSpec | undefined) => (spec !== undefined ? numberOf(spec, i, rng) * TURN : 0)
      const x = turn(seg.rotation.x)
      const y = turn(seg.rotation.y)
      const z = turn(seg.rotation.z)
      euler = { x, y, z }
    }
    const motion = seg.motion ? motionNumbers(seg.motion, i, rng) : undefined

    let pos = stepFrom(ctx, anchor, { frame: seg.frame, along, lateral })
    if (seg.seat === true) {
      if (surface) pos = pos.add(rampNormal(anchor.heading, ramp.incline).scale(seatHeight(shape, size)))
      else pos.y += seatHeight(shape, size)
    } else {
      for (const lift of seg.up ?? []) pos.y += lift
    }

    const material = seg.materials ? seg.materials[i % seg.materials.length] : seg.material
    buildElement(ctx, {
      spec: { ...seg, material },
      shape,
      pos,
      heading: anchor.heading,
      size,
      euler,
      motion,
      name: seg.label ?? 'scatter',
    })
  }
}

export function buildObstacle(ctx: ElementContext, seg: ObstacleSegment): void {
  if (!ctx.api.hasWorld) return
  const rng = seg.seedKey !== undefined ? stream(ctx, seg.seedKey) : null
  const items = seg.variants ? seg.variants[variantIndex(seg.variants.length, rngOrThrow(rng).next())] : seg.items
  if (!items) return
  const { items: _items, variants: _variants, seedKey: _seedKey, type: _type, ...group } = seg
  items.forEach((item, i) => {
    const { at, ...own } = item
    const spec: ElementSpec = { ...group, ...own, motion: mergeMotion(group.motion, own.motion) }
    const shape = spec.shape
    if (!shape) throw new Error('obstacle item needs a shape')
    const placed = placementPoint(ctx, at)
    let pos = placed.pos
    let motion: ElementBuild['motion']
    if (spec.motion) {
      motion = motionNumbers(spec.motion, i, rng)
      const travel = spec.motion.travel
      if (travel) {
        const top = pos.y + travel[0]
        const bottom = pos.y + travel[1]
        pos = new Vector3(pos.x, (top + bottom) / 2, pos.z)
        motion.amplitude = (top - bottom) / 2
      }
    }
    buildElement(ctx, { spec, shape, pos, heading: placed.heading, motion, name: spec.label ?? 'obstacle' })
  })
}

function rngOrThrow(rng: SeededRng | null): SeededRng {
  if (!rng) throw new Error('variants need a seedKey')
  return rng
}

export function buildSpinnerParts(ctx: ElementContext, seg: SpinnerPartsSegment): void {
  const { api } = ctx
  const spinner = ctx.cursor.lastSpinner
  if (!api.hasWorld || !spinner) return

  const parts: Array<{ angle: number; radius: number; step: number }> = []
  if (seg.ring) {
    const gap = degToRad(seg.ring.gapDeg ?? 0)
    const start = gap / 2
    const step = (TURN - gap) / (seg.ring.segments ?? seg.ring.count)
    const radius = seg.radius ?? spinner.radius * (seg.radiusFactor ?? 1)
    for (let i = 0; i < seg.ring.count; i++) parts.push({ angle: start + i * step, radius, step })
  } else {
    for (const point of seg.points ?? []) parts.push({ angle: degToRad(point.angleDeg), radius: point.radius, step: 0 })
  }

  let own: EmittedCollider | null = null
  for (const part of parts) {
    const lx = Math.sin(part.angle) * part.radius
    const lz = Math.cos(part.angle) * part.radius
    const opts: DescOptions = {}
    if (seg.yaw === true) {
      const q = Quaternion.FromEulerAngles(0, part.angle, 0)
      opts.rotation = { x: q.x, y: q.y, z: q.z, w: q.w }
    }
    if (seg.sensor === true) opts.sensor = true
    if (seg.label !== undefined) opts.label = seg.label

    const local = { x: lx, y: seg.y, z: lz }
    const shape = seg.shape
    const partDesc = (position: { x: number; y: number; z: number }, extra: DescOptions): AdventureColliderDesc => {
      if (shape.kind === 'cylinder') return cylinderDesc(position, shape.height / 2, shape.diameter / 2, { ...opts, ...extra })
      const depth = shape.size.z === 'arc' ? (part.radius * part.step) / 2 + (shape.arcPad ?? 0) : shape.size.z / 2
      return boxDesc(position, { x: shape.size.x / 2, y: shape.size.y / 2, z: depth }, { ...opts, ...extra })
    }

    if (seg.body === 'own') {
      if (!own) {
        own = api.emitCollider(
          partDesc(
            { x: spinner.center.x, y: spinner.center.y, z: spinner.center.z },
            { motion: 'kinematic-velocity', angularVelocity: { x: 0, y: spinner.angVel, z: 0 }, localPosition: local },
          ),
        )
        if (seg.reset === true) api.resetSensors.push(own.body)
        api.adventureBodies.push(own.body)
      } else {
        api.attachCollider(own, partDesc(local, {}))
      }
    } else {
      api.attachCollider(spinner.body, partDesc(local, {}))
    }

    if (seg.mesh === false) continue
    const mesh = seg.mesh?.shape
      ? meshOfMeshShape(ctx, seg.mesh.shape, seg.label ?? 'spinnerPart')
      : shape.kind === 'cylinder'
        ? MeshBuilder.CreateCylinder(seg.label ?? 'spinnerPart', { diameter: shape.diameter, height: shape.height }, api.scene)
        : MeshBuilder.CreateBox(
            seg.label ?? 'spinnerPart',
            {
              width: shape.size.x,
              height: shape.size.y,
              depth: shape.size.z === 'arc' ? part.radius * part.step + 2 * (shape.arcPad ?? 0) : shape.size.z,
            },
            api.scene,
          )
    mesh.parent = spinner.mesh
    mesh.position.set(lx, seg.mesh?.y ?? seg.y, lz)
    if (seg.yaw === true) mesh.rotation.y = part.angle
    mesh.material = ctx.material(seg.material)
  }
}

export function buildPinRows(ctx: ElementContext, seg: PinRowsSegment): void {
  const { api, cursor } = ctx
  if (!api.hasWorld) return
  const ramp = rampAnchor(cursor)
  const width = cursor.lastRampWidth ?? 0
  const fwd = forward(ramp.heading)
  const right = rightOf(ramp.heading)
  // The Pachinko Hall lane lifted its pins along the heading-0 ramp normal; kept for parity.
  const normal = new Vector3(0, Math.cos(ramp.incline), Math.sin(ramp.incline))
  const rows = Math.max(2, Math.floor(ramp.length / seg.spacing) - 1)
  const material = ctx.material(seg.material)
  const lift = seg.lift ?? 0
  const margin = seg.edgeMargin ?? 0
  const q = Quaternion.FromEulerAngles(ramp.incline, ramp.heading, 0)

  for (let row = 1; row <= rows; row++) {
    const dist = row * seg.spacing
    const offsets = row % 2 === 0 ? seg.evenOffsets : seg.oddOffsets
    for (const lateral of offsets) {
      if (Math.abs(lateral) > width / 2 - margin) continue
      const base = ramp.start.add(fwd.scale(dist * Math.cos(ramp.incline))).add(right.scale(lateral))
      base.y -= dist * Math.sin(ramp.incline)
      const pinPos = base.add(normal.scale(lift + seg.pinHeight / 2))

      const pin = MeshBuilder.CreateCylinder(seg.label ?? 'pin', { diameter: seg.meshDiameter ?? seg.pinRadius * 2, height: seg.pinHeight }, api.scene)
      pin.position.copyFrom(pinPos)
      pin.rotation.x = ramp.incline
      pin.rotation.y = ramp.heading
      pin.material = material
      api.adventureTrack.push(pin)

      const opts: DescOptions = { rotation: { x: q.x, y: q.y, z: q.z, w: q.w } }
      if (seg.restitution !== undefined) opts.restitution = seg.restitution
      if (seg.label !== undefined) opts.label = seg.label
      const { body } = api.emitCollider(cylinderDesc({ x: pinPos.x, y: pinPos.y, z: pinPos.z }, seg.pinHeight / 2, seg.pinRadius, opts))
      api.adventureBodies.push(body)
    }
  }
}

export function buildArcPylon(ctx: ElementContext, seg: ArcPylonSegment): void {
  const pos = seg.at ? placementPoint(ctx, seg.at).pos : ctx.cursor.pos
  ctx.api.createArcPylon(pos, ctx.material(seg.material))
}

export function buildDecor(ctx: ElementContext, seg: DecorSegment): void {
  const { api } = ctx
  const parent = seg.parent === 'spinner' ? ctx.cursor.lastSpinner?.mesh : undefined
  if (seg.parent === 'spinner' && !parent) return
  for (const item of seg.items) {
    let mesh: Mesh
    if (item.to !== undefined) {
      const path = [placementPoint(ctx, item.at).pos, placementPoint(ctx, item.to).pos]
      mesh = MeshBuilder.CreateTube('decor', { path, radius: item.tubeRadius ?? 0.1 }, api.scene)
    } else if (item.shape) {
      mesh = meshOfMeshShape(ctx, item.shape, 'decor')
      if (parent) {
        mesh.parent = parent
        const local = item.local ?? { x: 0, y: 0, z: 0 }
        mesh.position.set(local.x, local.y, local.z)
      } else {
        mesh.position.copyFrom(placementPoint(ctx, item.at).pos)
      }
    } else {
      continue
    }
    if (item.rotationDeg) {
      mesh.rotation.x = degToRad(item.rotationDeg.x)
      mesh.rotation.y = degToRad(item.rotationDeg.y)
      mesh.rotation.z = degToRad(item.rotationDeg.z)
    }
    mesh.material = ctx.material(item.material)
    if (!parent) api.adventureTrack.push(mesh)
  }
}
