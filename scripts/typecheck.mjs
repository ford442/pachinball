#!/usr/bin/env node
/**
 * Type-check the whole project (`tsc -b`: app, node, worker, worklet and test projects).
 *
 *   node scripts/typecheck.mjs            TypeScript 7 (native compiler, `typescript7` in package.json)
 *   node scripts/typecheck.mjs --ts6      TypeScript 6 (`typescript`, the version typescript-eslint supports)
 *   node scripts/typecheck.mjs --compare  both, then diff their diagnostics (CI runs this)
 *
 * Why two compilers: `typescript-eslint` peers `typescript <6.1`, so `typescript` stays ~6.0 for
 * type-aware lint, and TS 7 (a Go port, ~5x faster here) is installed beside it under the npm alias
 * `typescript7`. Both packages declare a `tsc` bin and npm links one of them to node_modules/.bin/tsc,
 * so a bare `tsc` / `npx tsc` is ambiguous: nothing in this repo calls it. Everything goes through
 * this script (or `node_modules/<pkg>/bin/tsc` by path), and the compiler is always named.
 *
 * When typescript-eslint publishes TS 7 support, move `typescript` to 7, delete `typescript7` and
 * the `--ts6` / `--compare` modes (see the dependabot.yml `ignore` note).
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const COMPILERS = {
  ts7: { label: 'TypeScript 7', bin: 'node_modules/typescript7/bin/tsc' },
  ts6: { label: 'TypeScript 6', bin: 'node_modules/typescript/bin/tsc' },
}

const errorLine = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

/** Run `tsc -b` with one compiler; returns its parsed diagnostics (plain text, not --pretty). */
function runTsc(key, extraArgs = []) {
  const { bin } = COMPILERS[key]
  const started = process.hrtime.bigint()
  const result = spawnSync(process.execPath, [resolve(root, bin), '-b', '--pretty', 'false', ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const seconds = Number(process.hrtime.bigint() - started) / 1e9
  if (result.error) {
    console.error(`[typecheck] could not run ${COMPILERS[key].label}: ${result.error.message}`)
    process.exit(2)
  }
  const output = `${result.stdout}\n${result.stderr}`
  const diagnostics = output
    .split('\n')
    .map((line) => errorLine.exec(line))
    .filter(Boolean)
    .map(([, file, line, col, code, message]) => ({ file: file.replaceAll('\\', '/'), line, col, code, message }))
  if (diagnostics.length === 0 && result.status !== 0) {
    // The compiler failed without a diagnostic we can parse (bad tsconfig, crash): never pass silently.
    console.error(`[typecheck] ${COMPILERS[key].label} failed without parseable diagnostics:`)
    console.error(output.trim())
    process.exit(2)
  }
  return { key, diagnostics, seconds, status: result.status ?? 1 }
}

const format = (d) => `${d.file}(${d.line},${d.col}): ${d.code}: ${d.message}`
const identity = (d) => `${d.file}:${d.line}:${d.col}:${d.code}`

function report(run) {
  const { label } = COMPILERS[run.key]
  if (run.diagnostics.length === 0) {
    console.log(`[typecheck] ${label}: OK (${run.seconds.toFixed(1)} s)`)
    return
  }
  console.error(`[typecheck] ${label}: ${run.diagnostics.length} error(s) (${run.seconds.toFixed(1)} s)\n`)
  for (const d of run.diagnostics) console.error(`  ${format(d)}`)
}

const args = process.argv.slice(2)
const compare = args.includes('--compare')
const passthrough = args.filter((a) => a !== '--compare' && a !== '--ts6')

if (!compare) {
  const run = runTsc(args.includes('--ts6') ? 'ts6' : 'ts7', passthrough)
  report(run)
  process.exit(run.diagnostics.length > 0 ? 1 : 0)
}

// Compare mode: same project graph, two compilers. A tree that is clean on both passes. A divergence
// (an error only one compiler reports, or the same error at a different position) is printed as a
// diff so it can be filed upstream or fixed, and fails the run either way.
const ts6 = runTsc('ts6', passthrough)
const ts7 = runTsc('ts7', passthrough)
report(ts6)
report(ts7)

const six = new Map(ts6.diagnostics.map((d) => [identity(d), d]))
const seven = new Map(ts7.diagnostics.map((d) => [identity(d), d]))
const onlySix = [...six].filter(([k]) => !seven.has(k)).map(([, d]) => d)
const onlySeven = [...seven].filter(([k]) => !six.has(k)).map(([, d]) => d)

const speedup = ts7.seconds > 0 ? (ts6.seconds / ts7.seconds).toFixed(1) : 'n/a'
console.log(`[typecheck] TS 6 ${ts6.seconds.toFixed(1)} s vs TS 7 ${ts7.seconds.toFixed(1)} s (${speedup}x)`)
if (onlySix.length > 0 || onlySeven.length > 0) {
  console.error('\n[typecheck] diagnostics differ between the compilers:')
  for (const d of onlySix) console.error(`  only TS 6: ${format(d)}`)
  for (const d of onlySeven) console.error(`  only TS 7: ${format(d)}`)
}
process.exit(ts6.diagnostics.length > 0 || ts7.diagnostics.length > 0 || onlySix.length + onlySeven.length > 0 ? 1 : 0)
