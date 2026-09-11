/**
 * WASM physics parity runner — validates the compiled bundle against native C++ expectations.
 *
 * Native reference: native/tests/physics_world_test.cpp (Catch2)
 * Usage: node scripts/run-wasm-parity.mjs
 */

import { execFileSync, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Override for RelWithAsserts / bench artefacts, e.g.:
//   WASM_MODULE_PATH=native/build-assert/PhysicsModule.js node scripts/run-wasm-parity.mjs
const wasmModulePath = process.env.WASM_MODULE_PATH
  ? path.resolve(root, process.env.WASM_MODULE_PATH)
  : path.join(root, 'public/wasm/PhysicsModule.js')
const wasmModuleUrl = pathToFileURL(wasmModulePath).href
const buildNativeDir = path.join(root, 'native/build-native')
const nativeTest = path.join(buildNativeDir, 'physics_world_test')

if (!existsSync(wasmModulePath)) {
  console.error(`WASM module missing: ${wasmModulePath}`)
  console.error('Build with: npm run build:wasm  (or npm run build:wasm:assert)')
  process.exit(1)
}
console.log(`Using WASM module: ${wasmModulePath}`)

// 1. Native C++ reference (Catch2 suite via ctest or direct binary)
try {
  if (!existsSync(nativeTest)) {
    console.log('Native test binary missing — building via npm run test:native')
    execSync('npm run test:native', { cwd: root, stdio: 'inherit' })
  } else {
    execFileSync('ctest', ['--test-dir', buildNativeDir, '--output-on-failure'], {
      cwd: root,
      stdio: 'inherit',
    })
  }
  console.log('PASS native physics_world_test')
} catch {
  console.error('Native physics_world_test missing or failed — run: npm run test:native')
  process.exit(1)
}

// 2. WASM bundle scenarios (same initial conditions as native tests)
const { default: factory } = await import(wasmModuleUrl)
const Module = await factory()

function runScenario(name, setup, assertFn) {
  const world = new Module.PhysicsWorld()
  setup(world)
  for (let i = 0; i < 120; i++) {
    world.step(1 / 60)
  }
  const ok = assertFn(world)
  world.delete()
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  return ok
}

let failed = false

failed ||= !runScenario('wasm ball-on-box', (w) => {
  w.setGravity(0, -9.81, 0)
  // px,py,pz, hx,hy,hz, qx,qy,qz,qw, restitution, friction
  w.addStaticBox(0, 0, 0, 2, 0.5, 2, 0, 0, 0, 1, 0.4, 0.2)
  // px,py,pz, vx,vy,vz, mass,radius,restitution,damping, bodyType, shape, capsuleHalfHeight, friction, angularDamping
  w.createRigidBody(0, 2, 0, 0, 0, 0, 1, 0.25, 0.5, 0.02, 0, 0, 0.5, 0.2, 0.1)
}, (w) => {
  const y = w.getPosY(0)
  return y > 0.5 && y < 1.2
})

failed ||= !runScenario('wasm ball-on-capsule', (w) => {
  w.setGravity(0, -9.81, 0)
  w.addStaticCapsule(0, 1, 0, 0.4, 0.5, 0, 0, 0, 1, 0.4, 0.2)
  w.createRigidBody(0, 3, 0, 0, 0, 0, 1, 0.2, 0.5, 0.02, 0, 0, 0.5, 0.2, 0.1)
}, (w) => {
  const y = w.getPosY(0)
  return y > 1.0 && y < 3.5
})

failed ||= !runScenario('wasm ball+bumper drop', (w) => {
  w.setGravity(0, -9.81, -5)
  w.addStaticPlane(0, 1, 0, 0, 0.18)
  w.createRigidBody(0, 2, 0, 0, 0, 0, 1, 0.25, 0.76, 0.1, 0, 0, 0.5, 0.14, 0.18)
  w.createRigidBody(0, 0.5, 0, 0, 0, 0, 0, 0.4, 0.94, 0, 1, 0, 0.5, 0.05, 0)
}, (w) => {
  const y = w.getPosY(0)
  return y < 2.0 && y > 0.3
})

failed ||= !runScenario('wasm kinematic capsule flings ball', (w) => {
  w.setGravity(0, 0, 0)
  w.createRigidBody(0, 1, 0, 5, 0, 0, 0, 0.4, 0.5, 0, 2, 1, 0.5, 0.2, 0)
  w.createRigidBody(0.58, 1, 0, 0, 0, 0, 1, 0.2, 0.5, 0, 0, 0, 0.5, 0.2, 0.1)
}, (w) => {
  return w.getVelX(1) > 1.0
})

failed ||= !runScenario('wasm spinning ball picks up tangential velocity', (w) => {
  w.setGravity(0, 0, 0)
  w.setRollingResistance(0)
  w.addStaticPlane(-1, 0, 0, -1, 0.8)
  const id = w.createRigidBody(0.7, 0, 0, 2, 0, 0, 1, 0.25, 0.4, 0, 0, 0, 0.5, 0.8, 0)
  w.setAngularVelocity(id, 0, 10, 0)
}, (w) => {
  return w.getVelZ(0) > 0.15 && w.getAngVelY(0) < 10
})

// Side-by-side Rapier compare for the same spinning-ball / wall IC.
// Sequential-impulse vs Rapier's solver will not match bit-exactly; slack is
// documented below. μ_a = μ_b = 0.8 so Average and GeometricMean coincide.
{
  const dt = 1 / 60
  const steps = 120
  const vzSlack = 0.25
  const wySlack = 0.75

  const wasm = new Module.PhysicsWorld()
  wasm.setGravity(0, 0, 0)
  wasm.setRollingResistance(0)
  wasm.addStaticPlane(-1, 0, 0, -1, 0.8)
  const wasmId = wasm.createRigidBody(0.7, 0, 0, 2, 0, 0, 1, 0.25, 0.4, 0, 0, 0, 0.5, 0.8, 0)
  wasm.setAngularVelocity(wasmId, 0, 10, 0)

  let rapierVz = null
  let rapierWy = null
  try {
    const RAPIER = await import('@dimforge/rapier3d-compat/rapier.es.js')
    try {
      await RAPIER.init({})
    } catch {
      try { await RAPIER.init() } catch { /* WASM already ready in some runners */ }
    }
    const rw = new RAPIER.World({ x: 0, y: 0, z: 0 })
    rw.integrationParameters.dt = dt
    // Inner face at x = 1, matching the WASM plane n·x = -1 with n = (-1,0,0).
    rw.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 10, 10)
        .setTranslation(1.5, 0, 0)
        .setFriction(0.8)
        .setRestitution(0.4)
    )
    const rb = rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0.7, 0, 0)
        .setLinvel(2, 0, 0)
        .setAngvel({ x: 0, y: 10, z: 0 })
        .setLinearDamping(0)
        .setAngularDamping(0)
        .setGravityScale(0)
    )
    rw.createCollider(
      RAPIER.ColliderDesc.ball(0.25).setFriction(0.8).setRestitution(0.4).setMass(1),
      rb
    )
    for (let i = 0; i < steps; i++) {
      wasm.step(dt)
      rw.step()
    }
    rapierVz = rb.linvel().z
    rapierWy = rb.angvel().y
    rw.free()
  } catch (err) {
    wasm.delete()
    console.error('Rapier init/step failed for spinning-ball compare:', err)
    failed = true
    console.log('FAIL wasm/rapier spinning-ball english')
  }

  if (rapierVz !== null) {
    const wasmVz = wasm.getVelZ(0)
    const wasmWy = wasm.getAngVelY(0)
    wasm.delete()
    const ok = wasmVz > 0.1 && rapierVz > 0.1
      && wasmWy < 10 && rapierWy < 10
      && Math.abs(wasmVz - rapierVz) <= vzSlack
      && Math.abs(wasmWy - rapierWy) <= wySlack
    console.log(
      `${ok ? 'PASS' : 'FAIL'} wasm/rapier spinning-ball english ` +
      `(vz wasm=${wasmVz.toFixed(3)} rapier=${rapierVz.toFixed(3)} ` +
      `wy wasm=${wasmWy.toFixed(3)} rapier=${rapierWy.toFixed(3)})`
    )
    if (!ok) failed = true
  }
}

function readContacts(mod, world) {
  const count = world.getContactCount()
  const ptr = world.getContactBufferPtr()
  if (!count || ptr == null) return []
  const heap = mod.HEAPF32
  if (!heap) throw new Error('Module.HEAPF32 missing — cannot drain contact buffer')
  const start = ptr >> 2
  const out = []
  for (let i = 0; i < count; i++) {
    const o = start + i * 12
    out.push({
      id1: heap[o],
      id2: heap[o + 1],
      impulse: heap[o + 8],
      phase: heap[o + 9],
    })
  }
  return out
}

// Rapier drainCollisionEvents emits begin/end only (`started` true then false).
// WASM Enter=0 / Exit=2 must match that edge order for a scripted rest-then-lift.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, -9.81, 0)
  world.addStaticPlane(0, 1, 0, 0, 0.2)
  world.createRigidBody(0, 0.25, 0, 0, 0, 0, 1, 0.25, 0, 0.05, 0, 0, 0.5, 0.5, 0.15)

  const planePhases = []
  for (let i = 0; i < 30; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id1 === -1 || c.id2 === -1) planePhases.push(c.phase)
    }
  }
  world.setBodyPosition(0, 0, 10, 0)
  world.setVelocity(0, 0, 0, 0)
  world.step(1 / 60)
  for (const c of readContacts(Module, world)) {
    if (c.id1 === -1 || c.id2 === -1) planePhases.push(c.phase)
  }
  world.delete()

  const edges = planePhases.filter((p) => p === 0 || p === 2)
  const rapierExpected = [0, 2] // Enter then Exit — Rapier begin/end
  const ok = edges.length >= 2 && edges[0] === rapierExpected[0] && edges[edges.length - 1] === rapierExpected[1]
    && planePhases.filter((p) => p === 0).length === 1
    && planePhases.some((p) => p === 1)
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm/rapier enter-exit ordering (edges=${JSON.stringify(edges)} phases=${JSON.stringify(planePhases)})`)
  if (!ok) failed = true
}

{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  const id = world.createRigidBody(0, 0, 0, 0, 0, 0, 1, 0.2, 0.4, 0, 0, 0, 0.5, 0.2, 0)
  const hid = world.createHinge(id, 0, 0, 0, 0, 1, 0, -3, 3)
  world.setHingeMotor(hid, 2, 50)
  for (let i = 0; i < 30; i++) world.step(1 / 60)
  const wy = world.getAngVelY(id)
  const ok = Math.abs(wy - 2) < 0.2 && Number.isFinite(world.getHingeAngle(hid))
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm hinge motor omega (wy=${wy.toFixed(3)})`)
  if (!ok) failed = true
  world.delete()
}

// #383 Slice A — kinematic OBB mover: a rising piston must launch a resting ball.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, -9.81, 0)
  const piston = world.addKinematicMover(0, 0, 0, 1, 0.1, 1, 0, 0, 0, 1, 0.3, 0.2)
  world.createRigidBody(0, 0.3, 0, 0, 0, 0, 1, 0.2, 0.3, 0, 0, 0, 0.5, 0.2, 0.1)
  for (let i = 0; i < 15; i++) world.step(1 / 60)
  const riseDist = 0.05
  const pistonVy = riseDist / (1 / 60)
  world.setNextKinematicTransform(piston, 0, riseDist, 0, 0, 0, 0, 1)
  world.step(1 / 60)
  const vy = world.getVelY(0)
  const ok = vy > pistonVy * 0.5
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm kinematic mover launches resting ball (vy=${vy.toFixed(3)}, pistonVy=${pistonVy.toFixed(3)})`)
  if (!ok) failed = true
  world.delete()
}

// #383 Slice A — sensor volume: crossing ball emits exactly one Enter + one Exit, zero impulse.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  const sensorId = world.addSensorVolume(0, 0, 0, 0.5, 0.5, 0.5, 0, 0, 0, 1)
  world.createRigidBody(-2, 0, 0, 2, 0, 0, 1, 0.1, 0.5, 0, 0, 0, 0.5, 0.5, 0)

  let enters = 0, exits = 0, impulseSeen = false
  for (let i = 0; i < 120; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id2 !== sensorId) continue
      if (c.impulse !== 0) impulseSeen = true
      if (c.phase === 0) enters++
      if (c.phase === 2) exits++
    }
  }
  const ok = enters === 1 && exits === 1 && !impulseSeen
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm sensor volume enter/exit (enters=${enters} exits=${exits} impulseSeen=${impulseSeen})`)
  if (!ok) failed = true
  world.delete()
}

// #383 Slice A — collision-group filter: mutually exclusive masks never pair.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  const a = world.createRigidBody(0, 0, 0, 0, 0, 0, 1, 0.3, 0.5, 0, 0, 0, 0.5, 0.2, 0.1)
  const b = world.createRigidBody(0.1, 0, 0, 0, 0, 0, 1, 0.3, 0.5, 0, 0, 0, 0.5, 0.2, 0.1)
  world.setCollisionGroups(a, 0x1, 0x1)
  world.setCollisionGroups(b, 0x2, 0x2)
  for (let i = 0; i < 5; i++) world.step(1 / 60)
  const ok = world.getContactCount() === 0
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm filtered bodies never pair (contactCount=${world.getContactCount()})`)
  if (!ok) failed = true
  world.delete()
}

// ---------------------------------------------------------------------------
// #383 Slice B — adventure geometry
// ---------------------------------------------------------------------------

/** Upload a triangle mesh through the heap, as PhysicsModule.ts does. */
function addMesh(world, vertices, indices, restitution = 0.1, friction = 0.05, doubleSided = false) {
  const vPtr = Module._malloc(vertices.byteLength)
  const iPtr = Module._malloc(indices.byteLength)
  Module.HEAPF32.set(vertices, vPtr >> 2)
  Module.HEAPU32.set(indices, iPtr >> 2)
  const id = world.addStaticTriangleMesh(
    vPtr, vertices.length / 3, iPtr, indices.length, restitution, friction, doubleSided
  )
  Module._free(vPtr)
  Module._free(iPtr)
  return id
}

/** Flat quad tilted `slopeDeg` about X, split on the 0–2 diagonal; +z is downhill. */
function rampMesh(halfWidth, halfLength, slopeDeg, centreY) {
  const s = Math.sin((slopeDeg * Math.PI) / 180)
  const c = Math.cos((slopeDeg * Math.PI) / 180)
  const corner = (x, z) => [x, centreY - z * s, z * c]
  return {
    vertices: Float32Array.from([
      ...corner(-halfWidth, -halfLength),
      ...corner(halfWidth, -halfLength),
      ...corner(halfWidth, halfLength),
      ...corner(-halfWidth, halfLength),
    ]),
    indices: Uint32Array.from([0, 3, 2, 0, 2, 1]),
  }
}

// Static cylinder: a ball dropped on a pin cap comes to rest on it.
failed ||= !runScenario('wasm ball rests on a static cylinder', (w) => {
  w.setGravity(0, -9.81, 0)
  w.addStaticCylinder(0, 0.5, 0, 0.6, 0.5, 0, 0, 0, 1, 0.1, 0.4)
  w.createRigidBody(0, 2, 0, 0, 0, 0, 1, 0.2, 0.1, 0, 0, 0, 0.5, 0.2, 0.1)
}, (w) => Math.abs(w.getPosY(0) - 1.2) < 0.08)

// Triangle mesh: a ball must roll downhill on a 15° ramp, not fall through it.
failed ||= !runScenario('wasm ball rolls down a triangle-mesh ramp', (w) => {
  w.setGravity(0, -9.81, 0)
  w.setRollingResistance(0)
  const { vertices, indices } = rampMesh(4, 6, 15, 2)
  addMesh(w, vertices, indices)
  w.createRigidBody(0, 3.35, -4, 0, 0, 0, 1, 0.2, 0.1, 0, 0, 0, 0.5, 0.05, 0.1)
}, (w) => w.getPosZ(0) > -3 && w.getVelZ(0) > 0.5 && w.getPosY(0) > 0)

// One-sidedness: approaching a mesh from behind its face must not collide.
failed ||= !runScenario('wasm one-sided mesh ignores contact from behind', (w) => {
  w.setGravity(0, 0, 0)
  const { vertices, indices } = rampMesh(4, 4, 0, 1)
  addMesh(w, vertices, indices)
  w.createRigidBody(0, 0, 0, 0, 3, 0, 1, 0.2, 0.5, 0, 0, 0, 0.5, 0.2, 0.1)
}, (w) => w.getPosY(0) > 1.5 && Math.abs(w.getVelY(0) - 3) < 0.1)

// Shaped sensors: a cylinder column fires exactly one enter and one exit.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  const sensorId = world.addSensorVolumeShaped(1, 0, 0, 0, 0.5, 2, 0.5, 0, 0, 0, 1)
  world.createRigidBody(-2, 0, 0, 2, 0, 0, 1, 0.1, 0.5, 0, 0, 0, 0.5, 0.5, 0)

  let enters = 0, exits = 0, impulseSeen = false
  for (let i = 0; i < 120; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id2 !== sensorId) continue
      if (c.impulse !== 0) impulseSeen = true
      if (c.phase === 0) enters++
      if (c.phase === 2) exits++
    }
  }
  const ok = enters === 1 && exits === 1 && !impulseSeen
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm cylinder sensor enter/exit (enters=${enters} exits=${exits})`)
  if (!ok) failed = true
  world.delete()
}

// Kinematic cylinder platter drags a resting ball around with it.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, -9.81, 0)
  const platter = world.addKinematicMoverShaped(1, 0, 0, 0, 2, 0.2, 2, 0, 0, 0, 1, 0, 1)
  world.createRigidBody(1, 0.45, 0, 0, 0, 0, 1, 0.2, 0, 0, 0, 0, 0.5, 1, 0.1)
  for (let i = 0; i < 20; i++) world.step(1 / 60)

  let angle = 0
  for (let i = 0; i < 40; i++) {
    angle += 2 * (1 / 60)
    world.setNextKinematicTransform(platter, 0, 0, 0, 0, Math.sin(angle / 2), 0, Math.cos(angle / 2))
    world.step(1 / 60)
  }
  // Right-handed spin about +Y carries +X toward -Z.
  const vz = world.getVelZ(0)
  const ok = vz < -0.3
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm kinematic cylinder platter drags ball (vz=${vz.toFixed(3)})`)
  if (!ok) failed = true
  world.delete()
}

// Force field: an updraft lifts a ball against gravity, mass-independently.
failed ||= !runScenario('wasm force field lifts ball against gravity', (w) => {
  w.setGravity(0, -9.81, 0)
  w.addForceField(0, 5, 0, 2, 5, 2, 0, 0, 0, 1, 0, 20, 0, 0, true)
  w.createRigidBody(0, 2, 0, 0, 0, 0, 1, 0.2, 0.1, 0, 0, 0, 0.5, 0.2, 0.1)
  w.createRigidBody(1, 2, 0, 0, 0, 0, 8, 0.2, 0.1, 0, 0, 0, 0.5, 0.2, 0.1)
}, (w) => w.getPosY(0) > 2.5 && Math.abs(w.getPosY(0) - w.getPosY(1)) < 0.05)

// Dynamic box: a crate settles on a static box instead of sinking or exploding.
failed ||= !runScenario('wasm dynamic box rests on a static box', (w) => {
  w.setGravity(0, -9.81, 0)
  w.addStaticBox(0, -0.5, 0, 5, 0.5, 5, 0, 0, 0, 1, 0.1, 0.6)
  w.createBoxBody(0, 1, 0, 0, 0, 0, 2, 0.3, 0.3, 0.3, 0, 0.02, 0, 0.6, 0.1)
}, (w) => Math.abs(w.getPosY(0) - 0.3) < 0.1 && Math.abs(w.getVelY(0)) < 0.3)

// clearStaticGeometry: a track switch must not leave the old geometry behind.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, -9.81, 0)
  world.addStaticBox(0, 0, 0, 5, 0.5, 5, 0, 0, 0, 1, 0.1, 0.4)
  const ball = world.createRigidBody(0, 2, 0, 0, 0, 0, 1, 0.2, 0.1, 0, 0, 0, 0.5, 0.2, 0.1)
  for (let i = 0; i < 90; i++) world.step(1 / 60)
  const restedY = world.getPosY(ball)

  world.clearStaticGeometry()
  world.setBodyPosition(ball, 0, 2, 0)
  world.setVelocity(ball, 0, 0, 0)
  for (let i = 0; i < 90; i++) world.step(1 / 60)
  const fellY = world.getPosY(ball)

  const ok = Math.abs(restedY - 0.7) < 0.1 && fellY < -3
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm clearStaticGeometry removes colliders (rested=${restedY.toFixed(2)} fell=${fellY.toFixed(2)})`)
  if (!ok) failed = true
  world.delete()
}

// Repeated track switches must not leak geometry: the same scene rebuilt five
// times has to behave identically to the first build.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, -9.81, 0)
  const ball = world.createRigidBody(0, 3, 0, 0, 0, 0, 1, 0.2, 0.1, 0, 0, 0, 0.5, 0.4, 0.1)
  const verts = Float32Array.from([-4, 1, -4, 4, 1, -4, 4, 1, 4, -4, 1, 4])
  const idx = Uint32Array.from([0, 3, 2, 0, 2, 1])

  const rested = []
  const contacts = []
  for (let cycle = 0; cycle < 5; cycle++) {
    world.clearStaticGeometry()
    addMesh(world, verts, idx, 0.1, 0.4)
    world.addStaticCylinder(1, 1.5, 0, 0.3, 0.5, 0, 0, 0, 1, 0.5, 0.3)
    world.addSensorVolumeShaped(0, -2, 1.5, 0, 0.5, 0.5, 0.5, 0, 0, 0, 1)
    world.setBodyPosition(ball, 0, 3, 0)
    world.setVelocity(ball, 0, 0, 0)
    for (let i = 0; i < 60; i++) world.step(1 / 60)
    rested.push(world.getPosY(ball))
    contacts.push(world.getContactCount())
  }
  const ok = rested.every((y) => Math.abs(y - rested[0]) < 1e-4) &&
             contacts.every((c) => c === contacts[0])
  console.log(
    `${ok ? 'PASS' : 'FAIL'} wasm repeated track switches leak no geometry ` +
    `(restY=[${rested.map((y) => y.toFixed(3)).join(',')}] contacts=[${contacts.join(',')}])`
  )
  if (!ok) failed = true
  world.delete()
}

// Side-by-side against Rapier: same 15° ramp as a trimesh in both engines.
// Tolerance is loose on purpose — the two solvers differ in detail; what must
// agree is that the ball stays on the surface and runs downhill at a similar rate.
{
  const dt = 1 / 60
  const steps = 120
  const { vertices, indices } = rampMesh(4, 6, 15, 2)

  const wasm = new Module.PhysicsWorld()
  wasm.setGravity(0, -9.81, 0)
  wasm.setRollingResistance(0)
  addMesh(wasm, vertices, indices)
  wasm.createRigidBody(0, 3.35, -4, 0, 0, 0, 1, 0.2, 0.1, 0, 0, 0, 0.5, 0.05, 0.1)

  let rapierZ = null
  try {
    const RAPIER = await import('@dimforge/rapier3d-compat/rapier.es.js')
    try {
      await RAPIER.init({})
    } catch {
      try { await RAPIER.init() } catch { /* WASM already ready in some runners */ }
    }
    const rw = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    rw.integrationParameters.dt = dt
    rw.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.05).setRestitution(0.1)
    )
    const rb = rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 3.35, -4)
        .setLinearDamping(0)
        .setAngularDamping(0.1)
    )
    rw.createCollider(
      RAPIER.ColliderDesc.ball(0.2).setFriction(0.05).setRestitution(0.1).setMass(1),
      rb
    )
    for (let i = 0; i < steps; i++) {
      wasm.step(dt)
      rw.step()
    }
    rapierZ = rb.translation().z
  } catch (err) {
    for (let i = 0; i < steps; i++) wasm.step(dt)
    console.log(`SKIP wasm/rapier mesh ramp (rapier unavailable: ${err?.message ?? err})`)
  }

  const wasmZ = wasm.getPosZ(0)
  const wasmY = wasm.getPosY(0)
  const onSurface = wasmY > 2 - wasmZ * Math.tan((15 * Math.PI) / 180) - 0.15
  if (rapierZ === null) {
    const ok = wasmZ > -3 && onSurface
    console.log(`${ok ? 'PASS' : 'FAIL'} wasm mesh ramp (no rapier) (z=${wasmZ.toFixed(3)})`)
    if (!ok) failed = true
  } else {
    const bothDownhill = wasmZ > -4 && rapierZ > -4
    const ok = bothDownhill && onSurface && Math.abs(wasmZ - rapierZ) < 2.0
    console.log(
      `${ok ? 'PASS' : 'FAIL'} wasm/rapier mesh ramp downhill ` +
      `(wasmZ=${wasmZ.toFixed(3)} rapierZ=${rapierZ.toFixed(3)})`
    )
    if (!ok) failed = true
  }
  wasm.delete()
}

process.exit(failed ? 1 : 0)
