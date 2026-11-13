#!/usr/bin/env node
/**
 * Build and run the libFuzzer targets (#520 §5) under ASan + UBSan.
 *
 *   npm run fuzz                         # both targets, 60 s each
 *   npm run fuzz -- --seconds 600        # longer
 *   npm run fuzz -- --only fuzz_command_stream
 *   npm run fuzz -- --no-build           # reuse native/build-fuzz
 *
 * Needs clang++ with libFuzzer + compiler-rt (Ubuntu: clang-18
 * libclang-rt-18-dev). CXX picks the compiler when it names a clang.
 *
 * native/build-fuzz is configured Debug at -O1 with PACHINBALL_SANITIZE and
 * PACHINBALL_FUZZ on. Corpora live in native/build-fuzz/corpus/<target>:
 *   - fuzz_snapshot_restore starts from every golden tape's frame-0 snapshot
 *     (tests/replays/*.json `replay.initialSnapshot`);
 *   - fuzz_command_stream from a few synthetic streams (opcodes in
 *     native/fuzz/fuzz_command_stream.cpp).
 * A finding is written to native/build-fuzz/artifacts/ and fails the run.
 * Reproduce one with the target binary and the file; for the command stream,
 * PACHINBALL_FUZZ_TRACE=1 prints the opcodes it ran.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'native/build-fuzz')
const TARGETS = ['fuzz_snapshot_restore', 'fuzz_command_stream']

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const seconds = Number(option('--seconds') ?? process.env.FUZZ_SECONDS ?? 60)
const only = option('--only')
const build = !args.includes('--no-build')
const targets = only ? TARGETS.filter((t) => t === only) : TARGETS
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`bad --seconds ${seconds}`)
if (targets.length === 0) throw new Error(`unknown target ${only}; one of ${TARGETS.join(', ')}`)

function sh(cmd, cmdArgs, env = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.error) throw r.error
  return r.status ?? 1
}

if (build) {
  const cxx = /clang/.test(process.env.CXX ?? '') ? process.env.CXX : 'clang++'
  const configure = sh('cmake', [
    '-S', 'native', '-B', 'native/build-fuzz',
    `-DCMAKE_CXX_COMPILER=${cxx}`,
    '-DCMAKE_BUILD_TYPE=Debug', '-DCMAKE_CXX_FLAGS_DEBUG=-g -O1',
    '-DPACHINBALL_SANITIZE=ON', '-DPACHINBALL_FUZZ=ON', '-DPACHINBALL_BUILD_TESTS=OFF',
  ])
  if (configure !== 0) process.exit(configure)
  const compiled = sh('cmake', ['--build', 'native/build-fuzz', '--parallel', '4'])
  if (compiled !== 0) process.exit(compiled)
}

// ---- Seed corpora -----------------------------------------------------------

const corpus = (target) => {
  const dir = join(buildDir, 'corpus', target)
  mkdirSync(dir, { recursive: true })
  return dir
}

let tapes = 0
for (const name of readdirSync(join(root, 'tests/replays')).filter((n) => n.endsWith('.json')).sort()) {
  const tape = JSON.parse(readFileSync(join(root, 'tests/replays', name), 'utf8'))
  const snapshot = tape?.replay?.initialSnapshot
  if (typeof snapshot !== 'string') continue
  writeFileSync(join(corpus('fuzz_snapshot_restore'), `tape-${name.replace(/\.json$/, '')}.bin`), Buffer.from(snapshot, 'base64'))
  tapes++
}
if (tapes === 0) throw new Error('no golden tape carries replay.initialSnapshot — nothing to seed fuzz_snapshot_restore with')

// Opcodes of fuzz_command_stream.cpp (enum Op) that a table session is made of.
const Op = { CreateBody: 0, CreateHinge: 10, SetHingeMotor: 11, AddStaticPlane: 13, AddStaticBox: 14, AddPinField: 19,
  AddKinematicMover: 22, SetNextKinematicTransform: 23, Step: 31, SerializeSnapshot: 32, RestoreSnapshot: 33 }
/** Deterministic filler (xorshift32): each op's arguments come from the bytes after it. */
function stream(seed, ops) {
  let x = seed >>> 0 || 1
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x & 0xff }
  const bytes = []
  for (const op of ops) {
    bytes.push(op)
    for (let i = 0; i < 40; i++) bytes.push(next())
  }
  return Buffer.from(bytes)
}
const sessions = {
  'plane-balls-steps': [Op.AddStaticPlane, Op.AddStaticBox, Op.CreateBody, Op.CreateBody, Op.Step, Op.Step, Op.Step, Op.SerializeSnapshot],
  'flipper-motor': [Op.AddStaticPlane, Op.CreateBody, Op.CreateHinge, Op.SetHingeMotor, Op.Step, Op.Step, Op.SerializeSnapshot, Op.RestoreSnapshot],
  'pins-mover': [Op.AddPinField, Op.AddKinematicMover, Op.CreateBody, Op.SetNextKinematicTransform, Op.Step, Op.SerializeSnapshot, Op.Step],
}
Object.entries(sessions).forEach(([name, ops], i) => {
  writeFileSync(join(corpus('fuzz_command_stream'), `seed-${name}.bin`), stream(0x9e3779b9 + i, ops))
})

// ---- Run ----------------------------------------------------------------------

const artifacts = join(buildDir, 'artifacts')
mkdirSync(artifacts, { recursive: true })
const sanitizerEnv = {
  ASAN_OPTIONS: 'abort_on_error=1:detect_leaks=1:strict_string_checks=1',
  UBSAN_OPTIONS: 'print_stacktrace=1:halt_on_error=1',
}

let failures = 0
for (const target of targets) {
  console.log(`[fuzz] ${target}: ${seconds} s`)
  const status = sh(join(buildDir, target), [
    `-max_total_time=${seconds}`,
    '-timeout=10',
    '-rss_limit_mb=2048',
    '-print_final_stats=1',
    `-artifact_prefix=${artifacts}/${target}-`,
    corpus(target),
  ], sanitizerEnv)
  if (status !== 0) {
    failures++
    console.error(`[fuzz] ${target} found a failure (exit ${status}); input saved under ${relative(root, artifacts)}/`)
  }
}
if (failures > 0) process.exit(1)
console.log(`[fuzz] OK — ${targets.join(', ')} ran ${seconds} s each without a finding`)
