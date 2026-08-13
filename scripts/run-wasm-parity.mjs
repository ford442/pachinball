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

process.exit(failed ? 1 : 0)
