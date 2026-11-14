/**
 * The headless replay runner's pieces (#528), without the C++ bundle: the table it authors, the
 * fail-closed guards around gameplay that still lives in presentation classes, and the shared sim
 * state (targets, backbox state). The full runner is checked against the golden tapes by
 * `npm run verify:replay:node` (CI, after `build:wasm`); that the runner never pulls in Babylon is
 * checked here, on every unit-test run.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import type { PhysicsBody } from '../src/core/physics-api'
import { GameConfig } from '../src/config'
import { DisplayState } from '../src/display/display-types'
import { ZoneSensors } from '../src/game-elements/zone-sensors'
import { ZoneTriggerSystem } from '../src/game-elements/zone-trigger-system'
import { SimDisplayState } from '../src/game/sim-display-state'
import { HeadlessGuard, NodeReplayUnsupported } from '../src/sim/headless-guard'
import {
  applyHeadlessFeederFlags,
  buildHeadlessTable,
  HeadlessGaussCannon,
  HeadlessMagSpin,
  HeadlessOpaqueFeeder,
} from '../src/sim/headless-table'
import { TargetBank } from '../src/table/target-bank'
import { WASM_PHYSICS_API as api } from '../src/wasm/wasm-physics-api'
import { WasmTableWorld } from '../src/wasm/wasm-table-world'
import type { WasmBody } from '../src/wasm/wasm-body'
import { asSimEngine, makeFakeWasmEngine } from './helpers/fake-wasm-engine'

const GRAVITY = { x: 0, y: -9.81, z: -5 }

function makeTable() {
  const world = new WasmTableWorld(asSimEngine(makeFakeWasmEngine()), GRAVITY)
  const zones = new ZoneTriggerSystem(false)
  zones.setSensors(new ZoneSensors(world, api))
  const guard = new HeadlessGuard()
  let mainBall: PhysicsBody | null = null
  const parts = buildHeadlessTable(world, api, zones, guard, () => {
    mainBall = world.createRigidBody(api.RigidBodyDesc.dynamic().setTranslation(10.5, 0.5, -9))
    world.createCollider(api.ColliderDesc.ball(GameConfig.ball.radius), mainBall)
  })
  return { world, zones, guard, parts, mainBall: () => mainBall }
}

/** A ball at `p`, as a feeder's capture test reads it. */
function ballAt(p: { x: number; y: number; z: number }): PhysicsBody {
  return { translation: () => p } as unknown as PhysicsBody
}

describe('buildHeadlessTable', () => {
  it('authors the in-scope statics in the game\'s boot order', () => {
    const { world, parts, zones } = makeTable()
    const scope = new Set<PhysicsBody>([
      ...parts.table.getWasmExportBodies(),
      ...parts.trap.getBodies(),
      ...parts.feeders.magSpin.getBodies(),
      ...zones.getSensorBodies(),
    ])
    // What the owner exports, in world creation order (WasmOwner.exportStaticScene).
    const exported = world.allBodies().filter((b: WasmBody) => scope.has(b) && !b.link)
    const shapes = exported.map((b) => b.colliders.map((c) => c.desc.shape.kind).join('+'))
    expect(shapes).toEqual([
      'axisPullField', // MagSpin's well
      'box', // spinner zone
      'cone+sphere', // the ball trap
      'box', 'box', 'box', // trap, launcher and gate zones
      'box', 'box', 'box', 'box', 'box', // walls
      'box', 'box', // corner wedges
      'box', // drain
      ...Array(GameConfig.table.laneSensors.length).fill('box'), // lane rollovers
      ...Array(12).fill('sphere+cylinder'), // vanilla bumpers
      'box', 'box', // slingshots
      'pinField', // the pachinko lattice (the catcher is a target, not exported)
      'box', 'box', 'box', 'box', // side and flipper-area rails
    ])
  })

  it('a machine rebuild drops the boot bumpers and pins and builds the layout\'s at the end', () => {
    const { world, parts } = makeTable()
    const bootBumpers = parts.table.getBumperBodies().slice()
    parts.table.rebuildMutableToys({
      seed: 1, seedId: 's', pins: [], feedersEnabled: { magSpin: false, nanoLoom: false, prismCore: false, gaussCannon: true, quantumTunnel: true },
      bumpers: [{ x: 0, z: 8, color: '#ffffff', scale: 1 }, { x: -4, z: 4, color: '#ffffff', scale: 1 }],
    })
    const bumpers = parts.table.getBumperBodies()
    // Slingshots stay; the two new bumpers replace the twelve.
    expect(bumpers).toHaveLength(2 + 2)
    for (const b of bootBumpers.slice(0, 12)) expect(world.getRigidBody(b.handle)).toBeNull()
    expect(world.allBodies().at(-1)?.colliders[0]?.desc.shape.kind).toBe('cylinder') // the new catcher, last
    expect(parts.table.getBumperVisuals().filter((v) => v.hologramAnchor)).toHaveLength(2)
  })

  it('gives every bumper its hologram anchor as data (no mesh)', () => {
    const { parts } = makeTable()
    const bumpers = parts.table.getBumperVisuals().filter((v) => v.hologramAnchor)
    expect(bumpers).toHaveLength(12)
    for (const v of bumpers) {
      const p = v.body.translation()
      expect(v.hologramAnchor).toEqual({ x: p.x, y: 1.8, z: p.z })
      expect(v.mesh).toBeUndefined()
    }
  })
})

describe('headless guards fail closed', () => {
  it('MagSpin: idle and enabled, a ball at the well stops the replay; disabled, nothing happens', () => {
    const guard = new HeadlessGuard()
    const magSpin = new HeadlessMagSpin(guard, null)
    const well = GameConfig.magSpin.feederPosition
    const inWell = ballAt({ x: well.x, y: well.y, z: well.z })

    magSpin.setGameplayEnabled(false)
    expect(() => magSpin.update(1 / 60, [inWell])).not.toThrow()
    magSpin.setGameplayEnabled(true)
    expect(() => magSpin.update(1 / 60, [ballAt({ x: 0, y: 0.5, z: -8 })])).not.toThrow()
    expect(() => magSpin.update(1 / 60, [inWell])).toThrow(NodeReplayUnsupported)
    expect(guard.reason).toMatch(/MagSpin/)
  })

  it('MagSpin never takes a ball still climbing the launch lane', () => {
    const guard = new HeadlessGuard()
    const magSpin = new HeadlessMagSpin(guard, null, { ...GameConfig.magSpin, feederPosition: { x: 10, y: 0.5, z: 0 } })
    expect(() => magSpin.update(1 / 60, [ballAt({ x: 10, y: 0.5, z: 0 })])).not.toThrow()
    expect(guard.reason).toBeNull()
  })

  it('Gauss cannon: a ball in the intake stops the replay', () => {
    const guard = new HeadlessGuard()
    const gauss = new HeadlessGaussCannon(guard)
    const p = GameConfig.gaussCannon.gaussPosition
    expect(() => gauss.update(1 / 60, [ballAt({ x: p.x + 10, y: p.y, z: p.z })])).not.toThrow()
    expect(() => gauss.update(1 / 60, [ballAt({ x: p.x, y: p.y, z: p.z })])).toThrow(NodeReplayUnsupported)
  })

  it('a feeder whose capture is not extracted yet stops the replay while it is in play', () => {
    const guard = new HeadlessGuard()
    const nanoLoom = new HeadlessOpaqueFeeder(guard, 'nano loom')
    nanoLoom.setGameplayEnabled(false)
    expect(() => nanoLoom.update(1 / 60, [])).not.toThrow()
    nanoLoom.setGameplayEnabled(true)
    expect(() => nanoLoom.update(1 / 60, [])).toThrow(/nano loom/)
  })

  it('feeder flags follow GameDelegates.applyFeederGameplayFlags (null: all on)', () => {
    const { parts } = makeTable()
    applyHeadlessFeederFlags(parts.feeders, { magSpin: false, nanoLoom: false, prismCore: false, gaussCannon: true, quantumTunnel: true })
    expect(() => parts.feeders.nanoLoom.update(1 / 60, [])).not.toThrow()
    expect(parts.feeders.magSpin.getBodies()[0]?.isEnabled()).toBe(false)
    applyHeadlessFeederFlags(parts.feeders, null)
    expect(parts.feeders.magSpin.getBodies()[0]?.isEnabled()).toBe(true)
    expect(() => parts.feeders.prismCore.update(1 / 60, [])).toThrow(NodeReplayUnsupported)
  })

  it('the ball trap: catching a ball stops the replay', () => {
    const { parts, guard } = makeTable()
    expect(() => parts.trap.catchBall()).toThrow(NodeReplayUnsupported)
    expect(guard.reason).toMatch(/trap/)
  })

  it('keeps the first reason', () => {
    const guard = new HeadlessGuard()
    expect(() => guard.fail('first')).toThrow()
    expect(() => guard.fail('second')).toThrow()
    expect(guard.reason).toBe('first')
  })
})

describe('shared sim state', () => {
  it('TargetBank: a downed target respawns after the respawn time, on the step it runs out', () => {
    const bank = new TargetBank(() => 0.05)
    const body = {} as PhysicsBody
    bank.add(body)
    expect(bank.deactivate(body)).toBe(0)
    expect(bank.deactivate(body)).toBe(-1) // already down
    const respawned: number[] = []
    bank.update(0.03, (i) => respawned.push(i))
    expect(bank.active[0]).toBe(false)
    bank.update(0.03, (i) => respawned.push(i))
    expect(bank.active[0]).toBe(true)
    expect(respawned).toEqual([0])
    bank.deactivate(body)
    bank.reset()
    expect(bank.active[0]).toBe(true)
  })

  it('SimDisplayState is the last display:set request, IDLE first', () => {
    const bus = new EventBus()
    const state = new SimDisplayState(bus)
    expect(state.get()).toBe(DisplayState.IDLE)
    bus.emit('display:set', DisplayState.FEVER)
    expect(state.get()).toBe(DisplayState.FEVER)
    state.dispose()
    bus.emit('display:set', DisplayState.IDLE)
    expect(state.get()).toBe(DisplayState.FEVER)
  })
})

describe('the Node runner bundle', () => {
  it('bundles src/sim/node-replay.ts with no @babylonjs module', async () => {
    const { buildSimBundle } = await import('../scripts/lib/sim-bundle.mjs')
    const dir = mkdtempSync(path.join(tmpdir(), 'pachinball-sim-test-'))
    try {
      const outfile = path.join(dir, 'node-replay.mjs')
      // buildSimBundle throws when any input is a Babylon module.
      const { inputs } = await buildSimBundle({ outfile })
      expect(inputs).toBeGreaterThan(50)
      const source = readFileSync(outfile, 'utf8')
      expect(source).toContain('function replayTapeInNode')
      expect(source).not.toMatch(/@babylonjs\//)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
