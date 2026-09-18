/**
 * wasm-worker parity against the real C++ engine (#414).
 *
 * Two independent PhysicsModule instances run the same adventure-shaped
 * scene: one in-process, one behind PhysicsWorkerClient → worker runtime →
 * shared snapshot layout, with the Worker replaced by a synchronous loopback.
 * Every handle the client's id shadow hands out must equal the native one, and
 * poses and contact streams must match exactly once the client has read the
 * last published snapshot.
 *
 * Skips when public/wasm/PhysicsModule.js has not been built.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EventBus } from '../src/core/event-bus'
import { WasmPhysicsEngine, WasmForceSpace, WasmVolumeShape } from '../src/wasm/PhysicsModule'
import { PhysicsWorkerClient } from '../src/wasm/physics-worker-client'
import {
  applyPhysicsCommand,
  createWorkerRuntimeState,
  WorkerSnapshotPublisher,
} from '../src/wasm/physics-worker-runtime'
import type { PhysicsWorkerFromWorker } from '../src/wasm/physics-worker-protocol'
import type { WasmSimEngine } from '../src/wasm/wasm-sim-engine'
import type { WasmContactEvent, WasmPhysicsModule } from '../src/wasm/wasm-types'

const bundle = resolve(__dirname, '../public/wasm/PhysicsModule.js')
const hasBundle = existsSync(bundle)

async function freshModule(): Promise<WasmPhysicsModule> {
  const { default: factory } = await import(/* @vite-ignore */ pathToFileURL(bundle).href) as {
    default: () => Promise<WasmPhysicsModule>
  }
  return factory()
}

type ContactKey = string
const keyOf = (c: WasmContactEvent): ContactKey => `${c.bodyId1}:${c.bodyId2}:${c.phase}:${c.isSensor}`

function recordContacts(engine: WasmSimEngine): ContactKey[] {
  const bus = new EventBus()
  const seen: ContactKey[] = []
  bus.on('wasm:physics:contact', (e) => { seen.push(keyOf(e as WasmContactEvent)) })
  engine.init(bus)
  return seen
}

async function workerPair(sharedAvailable: boolean) {
  const workerEngine = new WasmPhysicsEngine()
  await workerEngine.load(undefined, await freshModule())
  const runtime = createWorkerRuntimeState()
  const client = new PhysicsWorkerClient({ sharedTransport: true })
  const publisher = new WorkerSnapshotPublisher(
    (msg: PhysicsWorkerFromWorker) => client.receiveWorkerMessage(msg),
    sharedAvailable,
  )
  publisher.requestShared()
  client.attachLoopback((commands) => {
    let alpha = 0
    let stepped = false
    const cloned = structuredClone(commands)
    for (const cmd of cloned) {
      const result = applyPhysicsCommand(workerEngine, cmd, runtime)
      if (cmd.type === 'step') {
        alpha = result
        stepped = true
      }
    }
    if (stepped) publisher.publish(workerEngine, runtime, alpha, 0.5)
  })
  return client
}

const IDENT = { x: 0, y: 0, z: 0, w: 1 }
const tilt = { x: Math.sin(0.1), y: 0, z: 0, w: Math.cos(0.1) }

/** Adventure-shaped scene touching every worker command family. Returns every handle in order. */
function buildScene(e: WasmSimEngine): number[] {
  e.setGravity(0, -9.81, -2)
  e.addStaticPlane({ x: 0, y: 1, z: 0 }, 0, 0.2)
  const h: number[] = []
  h.push(e.addStaticBox({ x: 0, y: 0.25, z: -4 }, { x: 3, y: 0.25, z: 0.25 }, IDENT, 0.5, 0.2))
  h.push(e.addStaticCapsule({ x: -2, y: 0.5, z: 0 }, 0.2, 1, IDENT, 0.5, 0.2))
  h.push(e.addStaticCylinder({ x: 1.5, y: 0.5, z: -1 }, 0.4, 0.5, IDENT, 0.8, 0.1))
  h.push(e.addStaticSphere({ x: -1, y: 0.3, z: -2 }, 0.3, 0.6, 0.2))
  // A ramp mesh the balls land on, plus a degenerate one both sides must refuse.
  h.push(e.addStaticTriangleMesh(
    new Float32Array([-3, 1.5, 2, 3, 1.5, 2, 3, 0.8, -1, -3, 0.8, -1]),
    new Uint32Array([0, 2, 1, 0, 3, 2]),
    0.4, 0.2, true,
  ))
  h.push(e.addStaticTriangleMesh(new Float32Array([0, 0, 0]), new Uint32Array([0, 0, 0])))
  h.push(e.addSensorVolume({ x: 0, y: 0.5, z: -3 }, { x: 0.8, y: 0.5, z: 0.8 }, IDENT, WasmVolumeShape.Cylinder))
  const mover = e.addKinematicMover({ x: 0.5, y: 0.4, z: -2.5 }, { x: 0.6, y: 0.2, z: 0.6 }, tilt, 0.7, 0.2, WasmVolumeShape.Cylinder)
  h.push(mover)
  const field = e.addForceField({
    center: { x: 0, y: 1, z: 0 },
    halfExtents: { x: 3, y: 1, z: 1 },
    force: { x: 1.5, y: 0, z: 0 },
    space: WasmForceSpace.World,
    acceleration: true,
  })
  h.push(field)
  e.setForceFieldVector(field, 2, 0.5, 0)
  for (let i = 0; i < 4; i++) {
    h.push(e.createBody({ position: { x: -1.5 + i, y: 3 + i * 0.3, z: 1.5 }, mass: 1, radius: 0.25, restitution: 0.6, friction: 0.2 }))
  }
  h.push(e.createBoxBody({ position: { x: 1, y: 2.5, z: 0.5 }, halfExtents: { x: 0.3, y: 0.3, z: 0.3 }, mass: 2 }))
  e.setCollisionGroups(h[1], 0x1, 0xffff)
  e.setNextKinematicTransform(mover, { x: 0.6, y: 0.4, z: -2.5 }, tilt)
  return h
}

function poses(e: WasmSimEngine, ids: number[]) {
  return ids.map((id) => ({ ...e.getPosition(id), rot: e.getRotation(id), vel: e.getVelocity(id) }))
}

describe.skipIf(!hasBundle)('wasm-worker vs in-process engine (real C++)', () => {
  for (const sharedAvailable of [true, false]) {
    const label = sharedAvailable ? 'shared transport' : 'postMessage fallback'

    it(`${label}: identical handles, poses and contacts through a track switch`, async () => {
      const direct = new WasmPhysicsEngine()
      await direct.load(undefined, await freshModule())
      const client = await workerPair(sharedAvailable)
      const directContacts = recordContacts(direct)
      const clientContacts = recordContacts(client)

      const handles = buildScene(direct)
      expect(buildScene(client)).toEqual(handles)
      expect(handles.filter((h) => h === -1)).toHaveLength(1) // only the degenerate mesh
      const bodies = handles.filter((h) => h >= 0)

      const dt = 1 / 60
      const run = (steps: number) => {
        for (let i = 0; i < steps; i++) {
          direct.step(dt)
          client.step(dt)
        }
      }

      run(90)
      // A zero-dt step runs no substeps: it lets the client read the last
      // published snapshot, and must not re-deliver that step's contacts.
      client.step(0)
      direct.step(0)
      expect(poses(client, bodies)).toEqual(poses(direct, bodies))
      expect(clientContacts).toEqual(directContacts)
      expect(directContacts.length).toBeGreaterThan(0)

      // Track switch: statics restart in both id spaces; field toggles off.
      direct.clearStaticGeometry()
      client.clearStaticGeometry()
      const again = [
        direct.addStaticBox({ x: 0, y: 0.1, z: 0 }, { x: 4, y: 0.1, z: 4 }),
        direct.addForceField({ center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 }, force: { x: 0, y: 5, z: 0 } }),
        direct.addStaticTriangleMesh(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), new Uint32Array([0, 2, 1])),
      ]
      expect([
        client.addStaticBox({ x: 0, y: 0.1, z: 0 }, { x: 4, y: 0.1, z: 4 }),
        client.addForceField({ center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 }, force: { x: 0, y: 5, z: 0 } }),
        client.addStaticTriangleMesh(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), new Uint32Array([0, 2, 1])),
      ]).toEqual(again)
      expect(again).toEqual([-1000, -7000, -6000])
      direct.setForceFieldEnabled(again[1], false)
      client.setForceFieldEnabled(again[1], false)

      // Enough new bodies to outgrow the default 256 transform slots mid-run.
      for (let i = 0; i < 300; i++) {
        const desc = { position: { x: (i % 20) * 0.3 - 3, y: 1 + (i % 7) * 0.4, z: (i % 11) * 0.3 - 1.5 }, radius: 0.1 }
        expect(client.createBody(desc)).toBe(direct.createBody(desc))
      }
      run(30)
      client.step(0)
      direct.step(0)
      expect(poses(client, bodies)).toEqual(poses(direct, bodies))
      expect(poses(client, [bodies.length + 150, bodies.length + 299])).toEqual(poses(direct, [bodies.length + 150, bodies.length + 299]))
      expect(clientContacts).toEqual(directContacts)

      const stats = client.getTransportStats()
      if (sharedAvailable) {
        expect(stats.transport).toBe('shared')
        expect(stats.postMessageSnapshots).toBe(0)
        expect(stats.sharedSnapshots).toBeGreaterThan(100)
        expect(stats.sharedAttaches).toBeGreaterThanOrEqual(2) // first attach + growth
      } else {
        expect(stats.transport).toBe('post-message')
        expect(stats.sharedSnapshots).toBe(0)
        expect(stats.postMessageSnapshots).toBeGreaterThan(100)
      }
      expect(stats.staleSnapshots).toBe(0)
    })
  }
})
