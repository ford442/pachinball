/**
 * Worker command manifest (#459 Slice A, #464 item 2): every embind method on
 * the C++ `PhysicsWorld` has a recorded route to the worker, so the
 * `PhysicsWorkerCommand` union cannot lag `native/src/bindings.cpp` again.
 *
 * Reads source text only (no engine code). A new `.function("...")` fails the
 * first test until it is listed here; a listed command that is not in the union
 * fails the second.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** `read-back`: served by the step-result buffers or the client's id shadow. `in-process`: only meaningful next to the WASM heap. */
type Route = 'read-back' | 'in-process' | (string & {})

const MANIFEST: Record<string, Route> = {
  // Bodies
  createRigidBody: 'createBody',
  createRigidBodyDesc: 'createBody',
  createBoxBody: 'createBoxBody',
  removeRigidBody: 'removeBody',
  applyForce: 'applyForce',
  applyImpulse: 'applyImpulse',
  setVelocity: 'setVelocity',
  setAngularVelocity: 'setAngularVelocity',
  setBodyPosition: 'setBodyPosition',
  setBodyRotation: 'setBodyRotation',
  setBodyType: 'setBodyType',
  getBodyType: 'read-back',
  // Hinges
  createHinge: 'createHinge',
  setHingeMotor: 'setHingeMotor',
  getHingeAngle: 'read-back',
  removeHinge: 'removeHinge',
  // Statics
  addStaticPlane: 'addStaticPlane',
  addStaticBox: 'addStaticBox',
  addStaticCapsule: 'addStaticCapsule',
  addStaticCylinder: 'addStaticCylinder',
  addStaticSphere: 'addStaticSphere',
  addStaticCone: 'addStaticCone',
  addStaticTriangleMesh: 'addStaticTriangleMesh',
  addPinField: 'addPinField',
  getPinFieldPinCount: 'read-back',
  clearStaticGeometry: 'clearStaticGeometry',
  getDroppedStaticCount: 'read-back',
  addForceField: 'addForceField',
  addAxisPullField: 'addForceField',
  setForceFieldEnabled: 'setForceFieldEnabled',
  setForceFieldVector: 'setForceFieldVector',
  addKinematicMover: 'addKinematicMover',
  addKinematicMoverShaped: 'addKinematicMover',
  setNextKinematicTransform: 'setNextKinematicTransform',
  addSensorVolume: 'addSensorVolume',
  addSensorVolumeShaped: 'addSensorVolume',
  setCollisionGroups: 'setCollisionGroups',
  // Per-body reads: the packed transform buffer in the step result
  getPosX: 'read-back', getPosY: 'read-back', getPosZ: 'read-back',
  getVelX: 'read-back', getVelY: 'read-back', getVelZ: 'read-back',
  getAngVelX: 'read-back', getAngVelY: 'read-back', getAngVelZ: 'read-back',
  getRotX: 'read-back', getRotY: 'read-back', getRotZ: 'read-back', getRotW: 'read-back',
  // Stepping and world tunables
  step: 'step',
  getStepCount: 'read-back',
  getActiveBodyCount: 'read-back',
  setGravity: 'setGravity',
  setRollingResistance: 'setRollingResistance',
  getRollingResistance: 'read-back',
  // Contacts: the worker owns the buffer and ships it with each step result
  getContactBufferPtr: 'in-process',
  getContactCount: 'read-back',
  getDroppedContactCount: 'read-back',
  setMaxContacts: 'in-process',
  getMaxContacts: 'in-process',
  getContactGeneration: 'read-back',
  getTransformBufferPtr: 'in-process',
  getTransformStride: 'in-process',
  getTransformSlotCount: 'in-process',
  setContactCallbackJS: 'in-process',
  // Snapshots and hashes: each one rides a `snapshot-reply`
  serializeSnapshot: 'serializeSnapshot',
  restoreSnapshot: 'restoreSnapshot',
  getStaticContentHash: 'serializeSnapshot', // staticHash on every snapshot-reply
  getStateHash: 'getStateHash',
}

function embindWorldMethods(): string[] {
  const src = readFileSync(new URL('../native/src/bindings.cpp', import.meta.url), 'utf8')
  const start = src.indexOf('class_<PhysicsWorld>("PhysicsWorld")')
  expect(start, 'class_<PhysicsWorld> block not found in bindings.cpp').toBeGreaterThan(-1)
  return [...src.slice(start).matchAll(/\.function\("([A-Za-z0-9_]+)"/g)].map((m) => m[1]!)
}

function workerCommandTypes(): Set<string> {
  const src = readFileSync(new URL('../src/wasm/physics-worker-protocol.ts', import.meta.url), 'utf8')
  const start = src.indexOf('export type PhysicsWorkerCommand =')
  const end = src.indexOf('export type PhysicsWorkerToWorker')
  expect(start, 'PhysicsWorkerCommand union not found').toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return new Set([...src.slice(start, end).matchAll(/\{ type: '([A-Za-z0-9_]+)'/g)].map((m) => m[1]!))
}

describe('worker command manifest', () => {
  it('lists every embind PhysicsWorld method, and nothing bindings.cpp no longer has', () => {
    const embind = embindWorldMethods()
    expect(embind.length).toBeGreaterThan(40)
    expect(embind.filter((name) => !(name in MANIFEST)), 'embind methods without a worker route').toEqual([])
    expect(Object.keys(MANIFEST).filter((name) => !embind.includes(name)), 'stale manifest entries').toEqual([])
  })

  it('routes every command-backed method to a type in the PhysicsWorkerCommand union', () => {
    const commands = workerCommandTypes()
    expect(commands.has('step')).toBe(true)
    const missing = Object.entries(MANIFEST)
      .filter(([, route]) => route !== 'read-back' && route !== 'in-process' && !commands.has(route))
      .map(([name, route]) => `${name} -> ${route}`)
    expect(missing).toEqual([])
  })

  it('has a command for the hash accessors', () => {
    const commands = workerCommandTypes()
    expect(commands.has(MANIFEST.getStateHash!)).toBe(true)
    expect(commands.has(MANIFEST.getStaticContentHash!)).toBe(true)
  })
})
