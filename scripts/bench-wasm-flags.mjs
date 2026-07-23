/**
 * Microbench: WASM physics step time for 50 spheres across flag combos.
 *
 * Expects artefacts from:
 *   bash scripts/build-wasm.sh --bench-matrix
 * which writes native/build-bench/{baseline,simd,simd-lto}/PhysicsModule.js
 *
 * Usage:
 *   node scripts/bench-wasm-flags.mjs
 *   BENCH_STEPS=500 node scripts/bench-wasm-flags.mjs
 */

import { existsSync, statSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const benchRoot = path.join(root, 'native/build-bench')

const SPHERE_COUNT = 50
const WARMUP_STEPS = Number(process.env.BENCH_WARMUP ?? 30)
const TIMED_STEPS = Number(process.env.BENCH_STEPS ?? 300)
const DT = 1 / 60

const COMBOS = [
  { id: 'A', name: 'Baseline', dir: 'baseline', flags: 'Release + always-on size/env' },
  { id: 'B', name: '+SIMD', dir: 'simd', flags: 'A + -msimd128' },
  { id: 'C', name: '+SIMD+LTO', dir: 'simd-lto', flags: 'B + -flto' },
]

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function setupWorld(Module) {
  const world = new Module.PhysicsWorld()
  world.setGravity(0, -9.81, 0)
  world.addStaticPlane(0, 1, 0, 0)

  // Deterministic 5×10 grid of dynamic spheres above the floor
  const cols = 10
  const rows = Math.ceil(SPHERE_COUNT / cols)
  let id = 0
  for (let r = 0; r < rows && id < SPHERE_COUNT; r++) {
    for (let c = 0; c < cols && id < SPHERE_COUNT; c++, id++) {
      const x = (c - (cols - 1) / 2) * 0.55
      const z = (r - (rows - 1) / 2) * 0.55
      const y = 1.5 + r * 0.15
      // createRigidBody(px,py,pz, vx,vy,vz, mass,radius,restitution,damping, bodyType)
      world.createRigidBody(x, y, z, 0, 0, 0, 1, 0.2, 0.5, 0.02, 0)
    }
  }
  return world
}

async function benchCombo(combo) {
  const dir = path.join(benchRoot, combo.dir)
  const jsPath = path.join(dir, 'PhysicsModule.js')
  const wasmPath = path.join(dir, 'PhysicsModule.wasm')

  if (!existsSync(jsPath) || !existsSync(wasmPath)) {
    return {
      ...combo,
      error: `missing artefacts in ${dir} — run: bash scripts/build-wasm.sh --bench-matrix`,
    }
  }

  const wasmBytes = statSync(wasmPath).size
  const { default: factory } = await import(pathToFileURL(jsPath).href)
  const Module = await factory()
  const world = setupWorld(Module)

  for (let i = 0; i < WARMUP_STEPS; i++) {
    world.step(DT)
  }

  const samples = []
  for (let i = 0; i < TIMED_STEPS; i++) {
    const t0 = performance.now()
    world.step(DT)
    samples.push(performance.now() - t0)
  }

  world.delete()

  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length
  const p50 = percentile(sorted, 50)
  const p95 = percentile(sorted, 95)

  return {
    ...combo,
    wasmBytes,
    meanMs: mean,
    p50Ms: p50,
    p95Ms: p95,
    steps: TIMED_STEPS,
    spheres: SPHERE_COUNT,
  }
}

function fmtMs(n) {
  return Number.isFinite(n) ? n.toFixed(4) : 'n/a'
}

function fmtKb(bytes) {
  return Number.isFinite(bytes) ? (bytes / 1024).toFixed(1) : 'n/a'
}

const results = []
for (const combo of COMBOS) {
  process.stderr.write(`[bench] ${combo.id} ${combo.name}…\n`)
  results.push(await benchCombo(combo))
}

console.log('')
console.log(`WASM flag microbench — ${SPHERE_COUNT} spheres, warmup=${WARMUP_STEPS}, timed=${TIMED_STEPS}`)
console.log('')
console.log('| Combo | Flags | mean ms | p50 ms | p95 ms | .wasm KiB |')
console.log('|-------|-------|---------|--------|--------|-----------|')
for (const r of results) {
  if (r.error) {
    console.log(`| ${r.id} ${r.name} | ${r.flags} | ERROR | — | — | — |`)
    console.error(`  ${r.error}`)
    continue
  }
  console.log(
    `| ${r.id} ${r.name} | ${r.flags} | ${fmtMs(r.meanMs)} | ${fmtMs(r.p50Ms)} | ${fmtMs(r.p95Ms)} | ${fmtKb(r.wasmBytes)} |`,
  )
}
console.log('')

const failed = results.some((r) => r.error)
process.exit(failed ? 1 : 0)
