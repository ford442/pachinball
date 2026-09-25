#!/usr/bin/env node
/**
 * Drift check for docs/wasm-physics-engine.md. Fails when the doc:
 *   - still carries a retired claim (Rapier as production default, hybrid rollout),
 *   - lists EXPORTED_RUNTIME_METHODS / EXPORTED_FUNCTIONS that differ from native/CMakeLists.txt,
 *   - does not mark WASM_PHYSICS.defaultEngine (src/config/physics.ts) as the default mode,
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

const defaultEngine = read('src/config/physics.ts').match(/defaultEngine:\s*'([\w-]+)'/)?.[1]
if (!defaultEngine) {
  errors.push('WASM_PHYSICS.defaultEngine not found in src/config/physics.ts')
} else {
  const defaultRows = doc.split('\n').filter((line) => line.startsWith('|') && line.includes('(default)'))
  if (!defaultRows.some((line) => line.includes(`\`${defaultEngine}\``))) {
    errors.push(`mode table does not mark \`${defaultEngine}\` as (default)`)
  }
}

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
