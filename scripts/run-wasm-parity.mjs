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
      nx: heap[o + 2],
      ny: heap[o + 3],
      nz: heap[o + 4],
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

// #383 Slice B — static cylinder: side wall, end cap and rim all reflect.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  // px,py,pz, radius, halfHeight, qx,qy,qz,qw, restitution, friction
  const cylId = world.addStaticCylinder(0, 0, 0, 0.5, 2, 0, 0, 0, 1, 0.9, 0)
  world.createRigidBody(1.2, 0, 0, -4, 0, 0, 1, 0.1, 0.9, 0, 0, 0, 0.5, 0, 0)

  let normalX = null
  for (let i = 0; i < 60; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id2 === cylId && normalX === null) normalX = c.nx
    }
  }
  const vx = world.getVelX(0)
  const ok = cylId === -5000 && normalX !== null && Math.abs(normalX - 1) < 1e-3 && vx > 0.5
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm static cylinder side reflect (id=${cylId} nx=${normalX} vx=${vx.toFixed(3)})`)
  if (!ok) failed = true
  world.delete()
}

{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  const cylId = world.addStaticCylinder(0, 0, 0, 2, 0.5, 0, 0, 0, 1, 0.9, 0)
  world.createRigidBody(0.2, 1.5, 0, 0, -4, 0, 1, 0.1, 0.9, 0, 0, 0, 0.5, 0, 0)

  let normalY = null
  for (let i = 0; i < 60; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id2 === cylId && normalY === null) normalY = c.ny
    }
  }
  const vy = world.getVelY(0)
  const ok = normalY !== null && Math.abs(normalY - 1) < 1e-3 && vy > 0.5
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm static cylinder end-cap reflect (ny=${normalY} vy=${vy.toFixed(3)})`)
  if (!ok) failed = true
  world.delete()
}

{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  const R = 1, H = 0.5, d = Math.SQRT1_2
  const cylId = world.addStaticCylinder(0, 0, 0, R, H, 0, 0, 0, 1, 0.6, 0)
  world.createRigidBody(R + d * 0.9, H + d * 0.9, 0, -4 * d, -4 * d, 0, 1, 0.1, 0.6, 0, 0, 0, 0.5, 0, 0)

  let n = null
  for (let i = 0; i < 60; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id2 === cylId && n === null) n = { x: c.nx, y: c.ny, z: c.nz }
    }
  }
  const len = n ? Math.hypot(n.x, n.y, n.z) : 0
  const ok = n !== null && Number.isFinite(len) && Math.abs(len - 1) < 1e-3
    && n.x > 0.2 && n.y > 0.2 && Math.abs(n.z) < 1e-3
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm static cylinder rim normal (n=${JSON.stringify(n)} |n|=${len.toFixed(4)})`)
  if (!ok) failed = true
  world.delete()
}

// #383 Slice B — static sphere reflects, and its handle range is distinct.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  const sphId = world.addStaticSphere(0, 0, 0, 0.5, 0.9, 0)
  world.createRigidBody(0, 0, 1.2, 0, 0, -4, 1, 0.1, 0.9, 0, 0, 0, 0.5, 0, 0)

  let normalZ = null
  for (let i = 0; i < 60; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id2 === sphId && normalZ === null) normalZ = c.nz
    }
  }
  const vz = world.getVelZ(0)
  const ok = sphId === -6000 && normalZ !== null && Math.abs(normalZ - 1) < 1e-3 && vz > 0.5
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm static sphere reflect (id=${sphId} nz=${normalZ} vz=${vz.toFixed(3)})`)
  if (!ok) failed = true
  world.delete()
}

// #383 Slice B — a filter word must exclude the new static shapes too.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  const cylId = world.addStaticCylinder(0, 0, 0, 1, 2, 0, 0, 0, 1, 0.9, 0)
  const sphId = world.addStaticSphere(0, 6, 0, 1, 0.9, 0)
  world.setCollisionGroups(cylId, 0x0100, 0x0001)
  world.setCollisionGroups(sphId, 0x0100, 0x0001)
  const ghostA = world.createRigidBody(2, 0, 0, -4, 0, 0, 1, 0.1, 0.9, 0, 0, 0, 0.5, 0, 0)
  const ghostB = world.createRigidBody(2, 6, 0, -4, 0, 0, 1, 0.1, 0.9, 0, 0, 0, 0.5, 0, 0)
  world.setCollisionGroups(ghostA, 0x0004, 0x0002)
  world.setCollisionGroups(ghostB, 0x0004, 0x0002)

  let hits = 0
  for (let i = 0; i < 60; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id2 === cylId || c.id2 === sphId) hits++
    }
  }
  const ok = hits === 0 && world.getPosX(0) < -1 && world.getPosX(1) < -1
  console.log(`${ok ? 'PASS' : 'FAIL'} wasm filtered static cylinder/sphere pass-through (hits=${hits})`)
  if (!ok) failed = true
  world.delete()
}

// #383 Slice B — clearStaticGeometry: statics are append-only, so a rebuilt
// scene (new adventure track, fresh WasmOwner.rebuild) must be able to drop
// the old one instead of stacking a second copy.
{
  const world = new Module.PhysicsWorld()
  world.setGravity(0, 0, 0)
  const boxId = world.addStaticBox(0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0.9, 0)
  world.addStaticCylinder(0, 6, 0, 1, 2, 0, 0, 0, 1, 0.9, 0)
  world.addStaticSphere(0, 12, 0, 1, 0.9, 0)
  world.createRigidBody(4, 0, 0, -4, 0, 0, 1, 0.1, 0.9, 0, 0, 0, 0.5, 0, 0)

  let hitBefore = false
  for (let i = 0; i < 60; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id2 === boxId) hitBefore = true
    }
  }

  world.clearStaticGeometry()

  // Handles restart from their bases, so the next add reuses boxId.
  const reBoxId = world.addStaticBox(0, 40, 0, 1, 1, 1, 0, 0, 0, 1, 0.9, 0)

  world.setBodyPosition(0, 4, 0, 0)
  world.setVelocity(0, -4, 0, 0)
  let hitAfter = false
  for (let i = 0; i < 120; i++) {
    world.step(1 / 60)
    for (const c of readContacts(Module, world)) {
      if (c.id2 === boxId) hitAfter = true
    }
  }
  const x = world.getPosX(0)
  const ok = hitBefore && !hitAfter && reBoxId === boxId && x < -3
  console.log(
    `${ok ? 'PASS' : 'FAIL'} wasm clearStaticGeometry drops statics ` +
    `(hitBefore=${hitBefore} hitAfter=${hitAfter} reBoxId=${reBoxId} x=${x.toFixed(3)})`
  )
  if (!ok) failed = true
  world.delete()
}

process.exit(failed ? 1 : 0)
