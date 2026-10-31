#!/usr/bin/env node
/**
 * Drift check for docs/wasm-physics-engine.md. Fails when the doc:
 *   - still carries a retired claim (Rapier as production default, hybrid rollout),
 *   - lists EXPORTED_RUNTIME_METHODS / EXPORTED_FUNCTIONS that differ from native/CMakeLists.txt,
 *   - has no flag-table row for an Emscripten setting (-sNAME) or a compile/link flag
 *     (-f…, -m…, -l…, -W…, --…) that native/CMakeLists.txt passes,
 *   - does not mark WASM_PHYSICS.defaultEngine (src/config/physics.ts) as the `(default)` mode,
 *   - omits a native/src, native/tests, src/wasm or src/game/physics/wasm-* source file
 *     from its directory tree.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const docPath = 'docs/wasm-physics-engine.md'
const doc = read(docPath)
const errors = []

const RETIRED = [
  'production default stays Rapier',
  'Default production runtime physics engine stays Rapier',
  'supplement to',
  'Replace vs hybrid',
  'EXPORTED_RUNTIME_METHODS=["HEAPF32"]`',
]
for (const phrase of RETIRED) {
  if (doc.includes(phrase)) errors.push(`retired phrase still present: "${phrase}"`)
}

const cmake = read('native/CMakeLists.txt').replaceAll('\\"', '"')
for (const flag of ['-sEXPORTED_RUNTIME_METHODS', '-sEXPORTED_FUNCTIONS']) {
  const match = cmake.match(new RegExp(`${flag}=\\[[^\\]]*\\]`))
  if (!match) {
    errors.push(`${flag} not found in native/CMakeLists.txt`)
  } else if (!doc.includes(match[0])) {
    errors.push(`flag table does not contain \`${match[0]}\` (from CMakeLists.txt)`)
  }
}

const tableRows = doc.split('\n').filter((line) => line.startsWith('|'))
const tableText = tableRows.join('\n')

// Every flag CMake passes needs a rationale row, so none can land silently.
// Comments are stripped first (they quote flags we deliberately do not pass).
const cmakeCode = cmake.replace(/#.*$/gm, '')
for (const [, name] of cmakeCode.matchAll(/-s([A-Z][A-Z0-9_]+)/g)) {
  if (!tableText.includes(`-s${name}`) && !tableText.includes(`${name}=`)) {
    errors.push(`flag table has no row for Emscripten setting -s${name} (from CMakeLists.txt)`)
  }
}
const FLAG = /(?<=["\s;(])(--[a-z][a-z-]*(?:=\d+)?|-l[a-z]+|-f[a-z][a-z-]*(?:=[a-z]+)?|-m[a-z][a-z0-9]*|-W[a-z][a-z-]*)(?=["\s;),])/g
for (const flag of new Set([...cmakeCode.matchAll(FLAG)].map((m) => m[0]))) {
  if (!tableText.includes(flag)) {
    errors.push(`flag table has no row for \`${flag}\` (from CMakeLists.txt)`)
  }
}

const physicsConfig = read('src/config/physics.ts')
const modeRows = tableRows
const requireDefaultRow = (key, label) => {
  const engine = physicsConfig.match(new RegExp(`^\\s*${key}:\\s*'([\\w-]+)'`, 'm'))?.[1]
  if (!engine) {
    errors.push(`WASM_PHYSICS.${key} not found in src/config/physics.ts`)
  } else if (!modeRows.some((line) => line.includes(label) && line.includes(`\`${engine}\``))) {
    errors.push(`mode table does not mark \`${engine}\` as ${label}`)
  }
}
requireDefaultRow('defaultEngine', '(default)')

const listed = (dir, pattern) =>
  readdirSync(join(root, dir)).filter((name) => pattern.test(name))
const expectInTree = (name) => {
  const stem = name.replace(/\.(cpp|h|hpp|ts)$/, '')
  const candidates = name.endsWith('.ts') ? [name] : [name, `${stem}.h`, `${stem}.cpp`]
  if (!candidates.some((candidate) => doc.includes(candidate))) {
    errors.push(`directory tree omits ${name}`)
  }
}
for (const name of listed('native/src', /\.(cpp|h)$/)) expectInTree(name)
for (const name of listed('native/tests', /\.(cpp|hpp)$/)) expectInTree(name)
for (const name of listed('src/wasm', /\.ts$/)) expectInTree(name)
for (const name of listed('src/game/physics', /^wasm-.*\.ts$/)) expectInTree(name)

if (errors.length > 0) {
  for (const error of errors) console.error(`[wasm-docs] ${docPath}: ${error}`)
  process.exit(1)
}
console.log(`[wasm-docs] OK — ${docPath} matches CMake flags, default engine and source tree`)
