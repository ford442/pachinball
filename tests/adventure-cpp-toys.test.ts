/**
 * #424 Slice A — C++ toys as schema content.
 *
 * `pinLattice` and `forceField` segments compile to ONE `pinField` descriptor
 * and a `forceField` descriptor respectively; the exporter hands them to
 * `addPinField` / `addForceField`, never to a per-pin cylinder or a Rapier
 * sensor. STORM_LATTICE is the first track that uses only these plus the
 * existing box / cylinder / sensor / mover vocabulary.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  ADVENTURE_FILTER,
  ADVENTURE_MEMBERSHIP,
  descCollisionGroups,
  forceFieldDesc,
  pinFieldDesc,
  type AdventureColliderDesc,
} from '../src/adventure/track-collider-descriptors'
import { TrackColliderEmitter } from '../src/adventure/track-collider-emitter'
import { pinLatticeSpec, type TrackCursor } from '../src/adventure/track-compiler'
import {
  RAMP_HALF_THICKNESS,
  headingRight,
  rampForward,
  rampNormal,
  rampQuat,
  rotateByQuat,
  type GeoVec3,
} from '../src/adventure/track-geometry'
import {
  validateTrackDefinition,
  type PinLatticeSegment,
  type TrackSegment,
} from '../src/adventure/track-schema'
import {
  AdventureTrackProgression,
  CAMPAIGN_MAIN_PATH,
  TRACK_CATALOG,
} from '../src/adventure/adventure-track-progression'
import { getTrackManifest } from '../src/adventure/manifests'
import { AdventureTrackType } from '../src/adventure/adventure-types'
import { resolvePinField, type PinFieldSpec } from '../src/core/pin-field'
import { collectUnsupported, exportAdventureCollidersToWasm } from '../src/game/physics/wasm-adventure-export'
import { WasmForceSpace } from '../src/wasm/PhysicsModule'
import type { WasmSimEngine } from '../src/wasm/wasm-sim-engine'
import { ExportHarnessBuilder, exportReportFor } from './helpers/track-export-harness'

const ORIGIN = { x: 0, y: 0, z: 0 }

const dot = (a: GeoVec3, b: GeoVec3) => a.x * b.x + a.y * b.y + a.z * b.z
const sub = (a: GeoVec3, b: GeoVec3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

function expectVec(actual: GeoVec3, expected: GeoVec3, digits = 5): void {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.z).toBeCloseTo(expected.z, digits)
}

function recordingEngine() {
  const calls: { fn: string; args: unknown[] }[] = []
  // -1 is the exporter's "nothing created" sentinel, so start below it.
  let next = -100
  const rec = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args })
    return next--
  }
  const engine = {
    addStaticBox: rec('addStaticBox'),
    addStaticCylinder: rec('addStaticCylinder'),
    addStaticSphere: rec('addStaticSphere'),
    addStaticTriangleMesh: rec('addStaticTriangleMesh'),
    addSensorVolume: rec('addSensorVolume'),
    addKinematicMover: rec('addKinematicMover'),
    addPinField: rec('addPinField'),
    addForceField: rec('addForceField'),
    setCollisionGroups: (...args: unknown[]) => { calls.push({ fn: 'setCollisionGroups', args }) },
  }
  return { engine: engine as unknown as WasmSimEngine, calls, of: (fn: string) => calls.filter((c) => c.fn === fn) }
}

const lattice: PinFieldSpec = {
  origin: { x: -2, y: 5, z: 1 },
  rows: 4,
  cols: 5,
  spacingX: 1,
  spacingZ: 1.2,
  rowOffsetX: 0.5,
  radius: 0.15,
  halfHeight: 0.4,
  rotation: rampQuat(0.3, 0.6),
  restitution: 0.6,
  friction: 0.3,
}

describe('ramp frame', () => {
  it('rampQuat maps local X/Y/Z onto the ramp right / normal / down-slope vectors', () => {
    for (const [heading, incline] of [[0, 0], [0, 0.96], [0.7, 0.4], [Math.PI, 1.2], [-2.1, -0.3]]) {
      const q = rampQuat(heading, incline)
      expectVec(rotateByQuat(q, { x: 1, y: 0, z: 0 }), headingRight(heading))
      expectVec(rotateByQuat(q, { x: 0, y: 1, z: 0 }), rampNormal(heading, incline))
      expectVec(rotateByQuat(q, { x: 0, y: 0, z: 1 }), rampForward(heading, incline))
    }
  })
})

describe('pinLattice → one native pin field', () => {
  const segment: PinLatticeSegment = {
    type: 'pinLattice',
    rows: 6,
    cols: 5,
    spacing: 1.5,
    rowSpacing: 2,
    startAlong: 2,
    lateral: 0.5,
    diameter: 0.3,
    height: 0.8,
    holes: [{ row: 2, col: 2 }],
    dropout: 0.2,
    dropoutSeed: 7,
  }
  const heading = 0.4
  const incline = (50 * Math.PI) / 180
  const rampStart = { x: 3, y: 20, z: -1 }
  const cursor = {
    pos: rampStart,
    heading: heading + 1, // a turn after the ramp must not swing the lattice
    lastRampStart: rampStart,
    lastRampHeading: heading,
    lastInclineRad: incline,
    lastRampLength: 14,
  } as unknown as TrackCursor
  const spec = pinLatticeSpec(cursor, segment)

  it('stands every pin on the ramp surface, inside the ramp', () => {
    const normal = rampNormal(heading, incline)
    const fwd = rampForward(heading, incline)
    const right = headingRight(heading)
    const pins = resolvePinField(spec)
    expect(pins.length).toBeGreaterThan(0)
    for (const pin of pins) {
      const rel = sub(pin.position, rampStart)
      expect(dot(rel, normal)).toBeCloseTo(RAMP_HALF_THICKNESS + segment.height / 2, 4)
      const along = dot(rel, fwd)
      expect(along).toBeGreaterThanOrEqual(segment.startAlong! - 1e-4)
      expect(along).toBeLessThanOrEqual(segment.startAlong! + 5 * segment.rowSpacing! + 1e-4)
      // cols 5 at 1.5 pitch → ±3 about the lateral centre, odd rows +0.75.
      const lateral = dot(rel, right) - segment.lateral!
      expect(lateral).toBeGreaterThanOrEqual(-3 - 1e-4)
      expect(lateral).toBeLessThanOrEqual(3.75 + 1e-4)
    }
  })

  it('keeps the pin axis along the ramp normal', () => {
    expectVec(rotateByQuat(spec.rotation!, { x: 0, y: 1, z: 0 }), rampNormal(heading, incline))
  })

  it('leaves holes empty and drops slots by the seeded hash, deterministically', () => {
    const pins = resolvePinField(spec)
    expect(pins.some((p) => p.row === 2 && p.col === 2)).toBe(false)
    expect(pins.length).toBeLessThan(6 * 5 - 1)
    expect(resolvePinField(pinLatticeSpec(cursor, segment))).toEqual(pins)
    expect(spec.dropoutSeed).toBe(7)
  })

  it('defaults to the pachinko stagger and the per-pin segment bounce', () => {
    const plain = pinLatticeSpec(cursor, { type: 'pinLattice', rows: 2, cols: 2, spacing: 2, diameter: 0.2, height: 0.5 })
    expect(plain.rowOffsetX).toBe(1)
    expect(plain.spacingZ).toBe(2)
    expect(plain.restitution).toBe(0.6)
    expect(plain.occupancy).toBeUndefined()
    expect(plain.dropout).toBeUndefined()
  })
})

describe('exporter: pinField / forceField descriptors', () => {
  it('sends a pin field as ONE addPinField, with the descriptor material and groups', () => {
    const { engine, of } = recordingEngine()
    const desc = pinFieldDesc(lattice, { label: 'lattice' })
    const result = exportAdventureCollidersToWasm([desc], engine)
    expect(result.unsupported).toEqual([])
    expect(of('addPinField')).toHaveLength(1)
    expect(of('addStaticCylinder')).toHaveLength(0)
    const sent = of('addPinField')[0].args[0] as PinFieldSpec
    expect(sent.rows).toBe(4)
    expect(sent.restitution).toBe(0.6)
    expect(of('setCollisionGroups')[0].args).toEqual([-100, ADVENTURE_MEMBERSHIP, ADVENTURE_FILTER])
    expect(result.debug).toEqual([{ kind: 'pinField', field: sent }])
  })

  it('sends a force field as an acceleration box in the requested space', () => {
    const { engine, of } = recordingEngine()
    const q = rampQuat(0, 0.5)
    const result = exportAdventureCollidersToWasm([
      forceFieldDesc({ x: 1, y: 2, z: 3 }, { x: 1, y: 0.5, z: 2 }, { x: 0, y: 4, z: -1 }, { rotation: q, space: 'field' }),
      forceFieldDesc(ORIGIN, { x: 1, y: 1, z: 1 }, { x: 0, y: 9, z: 0 }),
    ], engine)
    expect(result.unsupported).toEqual([])
    const [local, world] = of('addForceField').map((c) => c.args[0] as Record<string, unknown>)
    const rot = local.rotation as typeof q
    expect([rot.x, rot.y, rot.z, rot.w].map((n) => n + 0)).toEqual([q.x, q.y, q.z, q.w].map((n) => n + 0))
    expect(local).toMatchObject({
      center: { x: 1, y: 2, z: 3 },
      halfExtents: { x: 1, y: 0.5, z: 2 },
      force: { x: 0, y: 4, z: -1 },
      space: WasmForceSpace.Local,
      acceleration: true,
    })
    expect(world).toMatchObject({ space: WasmForceSpace.World, acceleration: true })
    // Fields take the ball-only adventure groups like every other descriptor.
    expect(of('setCollisionGroups')).toHaveLength(2)
    expect(result.handles.size).toBe(2)
  })

  it('rejects a moving, attached or sensor pin field / force field', () => {
    const bad: AdventureColliderDesc[] = [
      { ...pinFieldDesc(lattice), motion: 'kinematic-position' },
      { ...forceFieldDesc(ORIGIN, { x: 1, y: 1, z: 1 }, ORIGIN), sensor: true },
      { ...pinFieldDesc(lattice), parentIndex: 0 },
      { ...pinFieldDesc(lattice), pinField: undefined },
    ]
    const unsupported = collectUnsupported(bad)
    expect(unsupported.map((u) => u.index)).toEqual([0, 1, 2, 3])
  })
})

describe('emitter: Rapier fallback and the C++ world', () => {
  function rapierWorld() {
    const colliders: { translation?: GeoVec3 }[] = []
    let handle = 0
    const chain = (rec: { translation?: GeoVec3 }) => {
      const self: Record<string, unknown> = {}
      for (const m of ['setFriction', 'setRestitution', 'setCollisionGroups', 'setRotation', 'setSensor', 'setActiveEvents', 'setDensity']) {
        self[m] = () => self
      }
      self.setTranslation = (x: number, y: number, z: number) => { rec.translation = { x, y, z }; return self }
      self.rec = rec
      return self
    }
    const api = {
      RigidBodyDesc: { fixed: () => ({ setTranslation() { return this }, setRotation() { return this } }) },
      ColliderDesc: { cylinder: vi.fn(() => chain({})) },
      ActiveEvents: { COLLISION_EVENTS: 1 },
    }
    const world = {
      gravity: { x: 0, y: -9.81, z: 0 },
      createRigidBody: vi.fn(() => ({ handle: handle++ })),
      createCollider: vi.fn((desc: { rec: { translation?: GeoVec3 } }) => { colliders.push(desc.rec); return {} }),
    }
    return { api, world, colliders }
  }

  it('builds one fixed cylinder per resolved pin on a world without pin fields', () => {
    const { api, world, colliders } = rapierWorld()
    const emitter = new TrackColliderEmitter(world as never, api as never)
    const { body, index } = emitter.emit(pinFieldDesc(lattice))
    const pins = resolvePinField(lattice)
    expect(index).toBe(0)
    expect(world.createRigidBody).toHaveBeenCalledTimes(1)
    expect(colliders).toHaveLength(pins.length)
    expect(colliders.map((c) => c.translation)).toEqual(pins.map((p) => p.position))
    expect(emitter.bodyForDescriptor(0)).toBe(body)
  })

  it('builds ONE pin-field body on a world that has them', () => {
    const created: PinFieldSpec[] = []
    const world = {
      gravity: ORIGIN,
      createRigidBody: vi.fn(),
      createCollider: vi.fn(),
      createPinField: (spec: PinFieldSpec) => { created.push(spec); return { handle: 9 } },
    }
    const emitter = new TrackColliderEmitter(world as never, {} as never)
    const desc = pinFieldDesc(lattice)
    emitter.emit(desc)
    expect(created).toHaveLength(1)
    expect(created[0].collisionGroups).toBe(descCollisionGroups(desc))
    expect(world.createRigidBody).not.toHaveBeenCalled()
    expect(world.createCollider).not.toHaveBeenCalled()
  })

  it('records a force field without building anything', () => {
    const world = { gravity: ORIGIN, createRigidBody: vi.fn(), createCollider: vi.fn() }
    const emitter = new TrackColliderEmitter(world as never, {} as never)
    const index = emitter.emitField(forceFieldDesc(ORIGIN, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 0 }))
    expect(index).toBe(0)
    expect(emitter.list()).toHaveLength(1)
    expect(emitter.bodyForDescriptor(0)).toBeNull()
    expect(world.createRigidBody).not.toHaveBeenCalled()
    expect(() => emitter.emit(forceFieldDesc(ORIGIN, { x: 1, y: 1, z: 1 }, ORIGIN))).toThrow(/emitField/)
  })
})

describe('schema: pinLattice / forceField validation', () => {
  const ramp: TrackSegment = { type: 'straight', width: 10, length: 20, inclineDeg: 50 }
  const validate = (...segments: unknown[]) =>
    validateTrackDefinition({ schemaVersion: 1, id: 'STORM_LATTICE', segments })
  const errorsOf = (...segments: unknown[]) => {
    const r = validate(...segments)
    return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`)
  }
  const pins = { type: 'pinLattice', rows: 5, cols: 5, spacing: 1.5, diameter: 0.3, height: 0.6 }
  const field = { type: 'forceField', size: { x: 2, y: 2, z: 4 }, accel: { x: 0, y: 5, z: 0 } }

  it('accepts a lattice and both field placements on a ramp', () => {
    expect(errorsOf(ramp, pins, { ...field, alongRamp: 10, lateral: 2 }, { ...field, offset: { x: 0, y: 1, z: 0 }, yawDeg: 45 })).toEqual([])
  })

  it('requires a straight before a lattice or a ramp-anchored field', () => {
    expect(errorsOf(pins).join()).toMatch(/must follow a straight/)
    expect(errorsOf({ ...field, alongRamp: 3 }).join()).toMatch(/must follow a straight/)
    expect(errorsOf({ ...field, offset: ORIGIN })).toEqual([])
  })

  it('refuses a lattice that does not fit on its ramp', () => {
    expect(errorsOf(ramp, { ...pins, rows: 20 }).join()).toMatch(/down a 20-long ramp/)
    expect(errorsOf(ramp, { ...pins, cols: 9 }).join()).toMatch(/across a 10-wide ramp/)
    expect(errorsOf(ramp, { ...pins, lateral: 3 }).join()).toMatch(/across a 10-wide ramp/)
  })

  it('checks lattice fields', () => {
    const errors = [
      ...errorsOf(ramp, { ...pins, rows: 2.5, dropout: 1, dropoutSeed: -1 }),
      ...errorsOf(ramp, { ...pins, holes: [{ row: 9, col: 0 }] }),
    ].join('\n')
    expect(errors).toMatch(/rows: must be an integer/)
    expect(errors).toMatch(/dropout: must be a number in \[0, 1\)/)
    expect(errors).toMatch(/dropoutSeed/)
    expect(errors).toMatch(/holes\[0\]/)
  })

  it('checks force-field fields', () => {
    const errors = errorsOf(
      ramp,
      { ...field, size: { x: 0, y: 1, z: 1 }, accel: { x: 0, y: 90, z: 0 }, space: 'local' },
      { ...field, alongRamp: 5, offset: ORIGIN },
      { ...field, lateral: 1 },
    ).join('\n')
    expect(errors).toMatch(/size\.x: must be > 0/)
    expect(errors).toMatch(/accel: magnitude/)
    expect(errors).toMatch(/space/)
    expect(errors).toMatch(/offset: only applies to a cursor-anchored field/)
    expect(errors).toMatch(/lateral: only applies to a ramp-anchored field/)
  })
})

describe('STORM_LATTICE — the first schema-only C++ toy track', () => {
  const raw = JSON.parse(
    readFileSync(join(import.meta.dirname, '../src/adventure/track-data/STORM_LATTICE.json'), 'utf8'),
  )

  function build() {
    const result = validateTrackDefinition(raw)
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    const builder = new ExportHarnessBuilder()
    const descriptors = builder.build(result.definition)
    return { builder, descriptors }
  }

  it('is a JSON track on the campaign spine, splitting the old QUANTUM_GRID → SINGULARITY_WELL A/A pair', () => {
    expect(getTrackManifest(AdventureTrackType.STORM_LATTICE)?.buildKind).toBe('json')
    const i = CAMPAIGN_MAIN_PATH.indexOf('STORM_LATTICE')
    expect(CAMPAIGN_MAIN_PATH[i - 1]).toBe('QUANTUM_GRID')
    expect(CAMPAIGN_MAIN_PATH[i + 1]).toBe('SINGULARITY_WELL')
    expect(TRACK_CATALOG.STORM_LATTICE.modeType).toBe('STATIONARY_TABLE')
  })

  it('exports fully to C++ using only box / cylinder / sensor / mover / pin-field / force-field', () => {
    const { builder, descriptors } = build()
    expect(exportReportFor(builder).problems).toEqual([])
    const kinds = new Set(descriptors.map((d) => d.kind))
    expect([...kinds].sort()).toEqual(['box', 'cylinder', 'forceField', 'pinField'])
    expect(descriptors.some((d) => d.sensor)).toBe(true)
    expect(descriptors.some((d) => d.motion === 'kinematic-velocity')).toBe(true)
    expect(descriptors.some((d) => d.motion === 'dynamic')).toBe(false)
  })

  it('carries its whole lattice as ONE pin-field handle, and four force fields', () => {
    const { descriptors } = build()
    const { engine, of } = recordingEngine()
    const result = exportAdventureCollidersToWasm(descriptors, engine)
    expect(result.unsupported).toEqual([])
    expect(of('addPinField')).toHaveLength(1)
    expect(of('addForceField')).toHaveLength(4)
    // The only cylinder is the mill — no per-pin static cylinders.
    expect(of('addStaticCylinder')).toHaveLength(0)
    const spec = of('addPinField')[0].args[0] as PinFieldSpec
    expect(resolvePinField(spec).length).toBeGreaterThan(60)
  })
})

describe('save migration for a stage inserted into the spine', () => {
  it('offers STORM_LATTICE to a save that completed QUANTUM_GRID before it existed', () => {
    const progression = new AdventureTrackProgression()
    const beaten = ['NEON_HELIX', 'PACHINKO_HALL', 'CYBER_CORE', 'QUANTUM_GRID']
    progression.loadSerializableState({
      completedTracks: beaten,
      // The old chain unlocked SINGULARITY_WELL straight from QUANTUM_GRID.
      unlockedTracks: [...beaten, 'PACHINKO_SPIRE', 'NEON_STRONGHOLD', 'SINGULARITY_WELL'],
      currentTrack: 'SINGULARITY_WELL',
    })
    expect(progression.isTrackUnlocked('STORM_LATTICE')).toBe(true)
    expect(progression.isTrackUnlocked('SINGULARITY_WELL')).toBe(true)
    expect(progression.getNextTrackId()).toBe('STORM_LATTICE')
  })
})
