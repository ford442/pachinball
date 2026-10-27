/**
 * `cone` and `axisPull` schema segments, and the uncatalogued fixture track
 * that uses them (tests/fixtures/tracks/FUNNEL_WELL.json).
 *
 *  - Both round-trip through the validator; bad values are refused at the
 *    segment's own path.
 *  - They compile to ONE `cone` descriptor and ONE `axisPullField`
 *    descriptor, which the wasm-owner exporter hands to `addStaticCone` and
 *    to the axis-pull `addForceField` — one handle each.
 *  - The Rapier dev path builds a Rapier cone and nothing for the well.
 *
 * The fixture borrows STORM_LATTICE's id (theme, camera, start anchor): the
 * validator only admits catalogued ids, and the track does not join the
 * catalog until #459 Slice B (continuous collision) lands.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'

import {
  axisPullFieldDesc,
  coneDesc,
  type AdventureColliderDesc,
} from '../src/adventure/track-collider-descriptors'
import { TrackColliderEmitter } from '../src/adventure/track-collider-emitter'
import { compileTrackDefinition, type TrackBuildApi } from '../src/adventure/track-compiler'
import {
  validateTrackDefinition,
  type TrackDefinition,
  type TrackSegment,
} from '../src/adventure/track-schema'
import { collectUnsupported, exportAdventureCollidersToWasm } from '../src/game/physics/wasm-adventure-export'
import type { PhysicsApi, PhysicsWorldSink } from '../src/core/physics-api'
import type { WasmSimEngine } from '../src/wasm/wasm-sim-engine'
import { ExportHarnessBuilder } from './helpers/track-export-harness'

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures/tracks/FUNNEL_WELL.json')
const fixtureText = readFileSync(FIXTURE_PATH, 'utf8')
const fixtureRaw = JSON.parse(fixtureText) as Record<string, unknown>

function fixture(): TrackDefinition {
  const result = validateTrackDefinition(fixtureRaw)
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.definition
}

function withSegments(segments: unknown[]): unknown {
  return { schemaVersion: 1, id: 'STORM_LATTICE', segments }
}

function errorsFor(segment: Record<string, unknown>) {
  const result = validateTrackDefinition(withSegments([segment]))
  return result.ok ? [] : result.errors
}

function recordingEngine(opts: { axisPullHandle?: number } = {}) {
  const calls: { fn: string; args: unknown[] }[] = []
  let next = -100
  const rec = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args })
    return next--
  }
  const engine = {
    addStaticBox: rec('addStaticBox'),
    addStaticCylinder: rec('addStaticCylinder'),
    addStaticSphere: rec('addStaticSphere'),
    addStaticCone: rec('addStaticCone'),
    addStaticTriangleMesh: rec('addStaticTriangleMesh'),
    addSensorVolume: rec('addSensorVolume'),
    addKinematicMover: rec('addKinematicMover'),
    addPinField: rec('addPinField'),
    addForceField: (desc: { mode?: string }) => {
      calls.push({ fn: 'addForceField', args: [desc] })
      if (desc.mode === 'axis-pull' && opts.axisPullHandle !== undefined) return opts.axisPullHandle
      return next--
    },
    setForceFieldEnabled: (...args: unknown[]) => { calls.push({ fn: 'setForceFieldEnabled', args }) },
    setCollisionGroups: (...args: unknown[]) => { calls.push({ fn: 'setCollisionGroups', args }) },
  }
  return { engine: engine as unknown as WasmSimEngine, calls, of: (fn: string) => calls.filter((c) => c.fn === fn) }
}

describe('cone / axisPull schema', () => {
  it('the fixture round-trips through the validator unchanged', () => {
    const result = validateTrackDefinition(fixtureRaw)
    expect(result.ok, result.ok ? '' : JSON.stringify(result.errors)).toBe(true)
    if (!result.ok) return
    expect(JSON.parse(JSON.stringify(result.definition))).toEqual(fixtureRaw)
    const cone = result.definition.segments.find((s) => s.type === 'cone')
    const well = result.definition.segments.find((s) => s.type === 'axisPull')
    expect(cone).toMatchObject({ radius: 1.2, halfHeight: 0.6 })
    expect(well).toMatchObject({ radius: 3, halfHeight: 1, strength: 8 })
  })

  it('accepts the minimal forms', () => {
    expect(errorsFor({ type: 'cone', radius: 1, halfHeight: 0.5 })).toEqual([])
    expect(errorsFor({ type: 'axisPull', radius: 2, strength: 5 })).toEqual([])
    expect(errorsFor({ type: 'axisPull', radius: 2, strength: 5, axis: { x: 0, y: -1, z: 0 }, enabled: false })).toEqual([])
  })

  it.each([
    [{ type: 'cone', radius: 0, halfHeight: 0.5 }, 'segments[0].radius'],
    [{ type: 'cone', radius: 1 }, 'segments[0].halfHeight'],
    [{ type: 'cone', radius: 1, halfHeight: 0.5, yawDeg: 'x' }, 'segments[0].yawDeg'],
    [{ type: 'cone', radius: 1, halfHeight: 0.5, friction: -1 }, 'segments[0].friction'],
    [{ type: 'cone', radius: 1, halfHeight: 0.5, offset: { x: 0, y: 0 } }, 'segments[0].offset.z'],
    [{ type: 'axisPull', strength: 5 }, 'segments[0].radius'],
    [{ type: 'axisPull', radius: 2 }, 'segments[0].strength'],
    [{ type: 'axisPull', radius: 2, strength: 61 }, 'segments[0].strength'],
    [{ type: 'axisPull', radius: 2, strength: 5, halfHeight: 0 }, 'segments[0].halfHeight'],
    [{ type: 'axisPull', radius: 2, strength: 5, axis: { x: 1, y: 0, z: 0 } }, 'segments[0].axis'],
    [{ type: 'axisPull', radius: 2, strength: 5, axis: { x: 0, y: 0, z: 0 } }, 'segments[0].axis'],
    [{ type: 'axisPull', radius: 2, strength: 5, enabled: 'yes' }, 'segments[0].enabled'],
    [{ type: 'axisPull', radius: 2, strength: 5, material: 'plasma' }, 'segments[0].material'],
  ])('refuses %j at %s', (segment, path) => {
    expect(errorsFor(segment).map((e) => e.path)).toContain(path)
  })
})

describe('FUNNEL_WELL fixture', () => {
  it('holds a pinLattice, a cone and an axisPull, and no Math.random', () => {
    const types = (fixtureRaw.segments as TrackSegment[]).map((s) => s.type)
    expect(types).toContain('pinLattice')
    expect(types.filter((t) => t === 'cone')).toHaveLength(1)
    expect(types.filter((t) => t === 'axisPull')).toHaveLength(1)
    expect(fixtureText).not.toMatch(/random/i)
  })

  it('is not catalogued: no track-data file loads it', () => {
    expect(existsSync(join(import.meta.dirname, '../src/adventure/track-data/FUNNEL_WELL.json'))).toBe(false)
  })

  it('a wasm-owner load reports one cone handle and one axis-pull field', () => {
    const builder = new ExportHarnessBuilder()
    const descriptors = builder.build(fixture())
    expect(collectUnsupported(descriptors)).toEqual([])

    const kinds = descriptors.map((d) => d.kind)
    expect(kinds.filter((k) => k === 'pinField')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'cone')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'axisPullField')).toHaveLength(1)

    const { engine, of } = recordingEngine()
    const result = exportAdventureCollidersToWasm(descriptors, engine)
    expect(result.unsupported).toEqual([])
    expect(of('addStaticCone')).toHaveLength(1)
    expect(of('addPinField')).toHaveLength(1)
    const wells = of('addForceField').filter((c) => (c.args[0] as { mode?: string }).mode === 'axis-pull')
    expect(wells).toHaveLength(1)
    expect(wells[0]?.args[0]).toMatchObject({
      halfExtents: { x: 3, y: 1, z: 3 },
      strength: 8,
      acceleration: true,
    })
    expect(of('setForceFieldEnabled')).toEqual([])

    const coneIndex = kinds.indexOf('cone')
    const wellIndex = kinds.indexOf('axisPullField')
    expect(result.handles.has(coneIndex)).toBe(true)
    expect(result.handles.has(wellIndex)).toBe(true)
  })
})

describe('compiler → TrackBuildApi', () => {
  function stubApi() {
    const calls: Record<string, unknown[][]> = {}
    const record = (name: string) => (...args: unknown[]) => {
      ;(calls[name] ??= []).push(args)
    }
    const api = new Proxy({} as Record<string, unknown>, {
      get: (target, key: string) => {
        if (key in target) return target[key]
        if (key === 'getTrackMaterial' || key === 'getThemedTrackMaterial') return () => ({})
        return record(key)
      },
    }) as unknown as TrackBuildApi
    return { api, calls }
  }

  it('seats a cone on cursor + offset with the cursor yaw and its defaults', () => {
    const { api, calls } = stubApi()
    ;(api as { currentStartPos: Vector3 }).currentStartPos = new Vector3(1, 2, 3)
    const def = validateTrackDefinition(withSegments([
      { type: 'cone', radius: 1.5, halfHeight: 0.75, offset: { x: 1, y: 0.25, z: -2 } },
    ]))
    if (!def.ok) throw new Error(JSON.stringify(def.errors))
    compileTrackDefinition(def.definition, api)
    const [base, radius, halfHeight, rotation, restitution, friction] = calls.createStaticCone?.[0] ?? []
    expect(base).toMatchObject({ x: 2, y: 2.25, z: 1 })
    expect([radius, halfHeight, restitution, friction]).toEqual([1.5, 0.75, 0.5, 0.3])
    expect(rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 })
  })

  it('passes axisPull defaults: halfHeight 1, enabled, visible', () => {
    const { api, calls } = stubApi()
    ;(api as { currentStartPos: Vector3 }).currentStartPos = new Vector3(0, 0, 0)
    const def = validateTrackDefinition(withSegments([{ type: 'axisPull', radius: 2, strength: 5 }]))
    if (!def.ok) throw new Error(JSON.stringify(def.errors))
    compileTrackDefinition(def.definition, api)
    const [, radius, halfHeight, strength, enabled, visible] = calls.createAxisPullWell?.[0] ?? []
    expect([radius, halfHeight, strength, enabled, visible]).toEqual([2, 1, 5, true, true])
  })
})

describe('exporter rules', () => {
  it('starts a disabled well switched off', () => {
    const { engine, of } = recordingEngine()
    const result = exportAdventureCollidersToWasm(
      [axisPullFieldDesc({ x: 0, y: 1, z: 0 }, 2, 1, 5, { enabled: false })],
      engine,
    )
    expect(result.unsupported).toEqual([])
    const handle = result.handles.get(0)
    expect(of('setForceFieldEnabled').map((c) => c.args)).toEqual([[handle, false]])
  })

  it('refuses a bundle without the axis-pull well instead of dropping it silently', () => {
    const { engine } = recordingEngine({ axisPullHandle: -1 })
    const result = exportAdventureCollidersToWasm([axisPullFieldDesc({ x: 0, y: 0, z: 0 }, 2, 1, 5)], engine)
    expect(result.unsupported.map((u) => u.reason)).toEqual(['this C++ bundle has no axis-pull force field'])
  })

  it('refuses a tilted well, a moving cone and a sensor cone', () => {
    const tilted: AdventureColliderDesc = {
      ...axisPullFieldDesc({ x: 0, y: 0, z: 0 }, 2, 1, 5),
      rotation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
    }
    const moving = coneDesc({ x: 0, y: 0, z: 0 }, 0.5, 1, { motion: 'kinematic-position' })
    const sensor = coneDesc({ x: 0, y: 0, z: 0 }, 0.5, 1, { sensor: true })
    expect(collectUnsupported([tilted, moving, sensor]).map((u) => u.index)).toEqual([0, 1, 2])
  })
})

describe('Rapier dev path', () => {
  function rapierWorld() {
    const bodies: unknown[] = []
    const colliders: unknown[] = []
    const chain = (shape: string, args: unknown[]) => {
      const desc: Record<string, unknown> = { shape, args }
      for (const m of ['setFriction', 'setRestitution', 'setCollisionGroups', 'setSensor', 'setActiveEvents', 'setDensity', 'setTranslation', 'setRotation']) {
        desc[m] = () => desc
      }
      return desc
    }
    const rapier = {
      RigidBodyDesc: new Proxy({}, { get: () => () => ({ setTranslation() { return this }, setRotation() { return this } }) }),
      ColliderDesc: new Proxy({}, { get: (_t, shape: string) => (...args: unknown[]) => chain(shape, args) }),
      ActiveEvents: { COLLISION_EVENTS: 1 },
    } as unknown as PhysicsApi
    const world = {
      createRigidBody: vi.fn((d: unknown) => {
        const body = { d, setAngvel: () => {} }
        bodies.push(body)
        return body
      }),
      createCollider: vi.fn((d: unknown) => {
        colliders.push(d)
        return {}
      }),
    } as unknown as PhysicsWorldSink
    return { rapier, world, bodies, colliders }
  }

  it('builds a Rapier cone (halfHeight, radius) and nothing for the well', () => {
    const { rapier, world, bodies, colliders } = rapierWorld()
    const emitter = new TrackColliderEmitter(world, rapier)
    emitter.emit(coneDesc({ x: 0, y: 1, z: 0 }, 0.6, 1.2))
    emitter.emitField(axisPullFieldDesc({ x: 0, y: 1, z: 0 }, 3, 1, 8))

    expect(bodies).toHaveLength(1)
    expect(colliders).toEqual([expect.objectContaining({ shape: 'cone', args: [0.6, 1.2] })])
    expect(emitter.list().map((d) => d.kind)).toEqual(['cone', 'axisPullField'])
    expect(() => emitter.emit(axisPullFieldDesc({ x: 0, y: 0, z: 0 }, 1, 1, 1))).toThrow(/emitField/)
  })
})
