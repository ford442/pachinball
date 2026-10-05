#!/usr/bin/env node
/**
 * noUncheckedIndexedAccess ratchet (#441).
 *
 * Type-checks src/ with `noUncheckedIndexedAccess` (tsconfig.index-strict.json) and fails on any
 * error inside ENFORCED_DIRS. Errors elsewhere are reported as a to-do count, not failures.
 * An out-of-range index in these directories is a physics/decoding bug, not a style issue.
 *
 * To extend the ratchet: fix a directory's errors, then add it to ENFORCED_DIRS. When all of
 * src/ is clean, set the flag in tsconfig.app.json and delete this script + the strict tsconfig.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENFORCED_DIRS = ['src/core/', 'src/wasm/', 'src/game/physics/']

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsc = resolve(root, 'node_modules/typescript/bin/tsc')
const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.index-strict.json', '--noEmit', '--pretty', 'false'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})

if (result.error) {
  console.error(`[index-strict] could not run tsc: ${result.error.message}`)
  process.exit(2)
}

const errorLine = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const errors = `${result.stdout}\n${result.stderr}`
  .split('\n')
  .map((line) => errorLine.exec(line))
  .filter(Boolean)
  .map(([, file, line, col, code, message]) => ({ file: file.replaceAll('\\', '/'), line, col, code, message }))

if (errors.length === 0 && result.status !== 0) {
  // tsc failed but produced nothing we can parse (bad tsconfig, crash): never pass silently.
  console.error('[index-strict] tsc failed without parseable diagnostics:')
  console.error(result.stdout || result.stderr)
  process.exit(2)
}

const enforced = errors.filter((e) => ENFORCED_DIRS.some((dir) => e.file.startsWith(dir)))
const others = errors.filter((e) => !enforced.includes(e))

const todo = new Map()
for (const e of others) {
  const dir = e.file.split('/').slice(0, 2).join('/')
  todo.set(dir, (todo.get(dir) ?? 0) + 1)
}

if (enforced.length > 0) {
  console.error(`[index-strict] ${enforced.length} error(s) in directories held to noUncheckedIndexedAccess:\n`)
  for (const e of enforced) console.error(`  ${e.file}(${e.line},${e.col}): ${e.code}: ${e.message}`)
  console.error(`\nEnforced: ${ENFORCED_DIRS.join(', ')}`)
  process.exit(1)
}

const remaining = [...todo.entries()].sort((a, b) => b[1] - a[1]).map(([dir, n]) => `${dir} ${n}`).join(', ')
console.log(`[index-strict] OK — ${ENFORCED_DIRS.join(', ')} are clean.`)
console.log(`[index-strict] ratchet backlog: ${others.length} error(s)${remaining ? ` (${remaining})` : ''}`)
