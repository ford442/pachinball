#!/usr/bin/env node
/**
 * Compile-database smoke check for clangd (see root .clangd).
 *
 * Run after `npm run compile-db` (or `npm run test:native`). Fails when:
 *   - native/build-native/compile_commands.json is missing,
 *   - any native/src/*.cpp (except Embind-only bindings.cpp) or native/tests/*.cpp
 *     TU is absent from it
 *     (the stale-emcc-dump failure that once dropped HingeJoint.cpp),
 *   - a project TU carries more than one -O level (e.g. -O0 and -O3),
 *   - a project TU was compiled by em++/emcc,
 *   - a stray compile_commands.json sits at the repo root or native/.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = join(root, 'native/build-native/compile_commands.json')
const errors = []

for (const stray of ['compile_commands.json', 'native/compile_commands.json']) {
  if (existsSync(join(root, stray))) {
    errors.push(`${stray} exists — clangd must only see native/build-native (delete it)`)
  }
}

if (!existsSync(dbPath)) {
  console.error(`[compile-db] ${relative(root, dbPath)} missing — run \`npm run compile-db\``)
  process.exit(1)
}

const entries = JSON.parse(readFileSync(dbPath, 'utf8'))
const projectEntries = new Map()
for (const entry of entries) {
  const file = relative(root, resolve(entry.directory, entry.file))
  if (file.startsWith('native/src/') || file.startsWith('native/tests/')) {
    projectEntries.set(file, entry)
  }
}

// bindings.cpp is Embind glue — Emscripten-only, never part of the native tree.
const EMSCRIPTEN_ONLY = new Set(['native/src/bindings.cpp'])
const expected = ['native/src', 'native/tests'].flatMap((dir) =>
  readdirSync(join(root, dir))
    .filter((name) => name.endsWith('.cpp'))
    .map((name) => `${dir}/${name}`)
    .filter((file) => !EMSCRIPTEN_ONLY.has(file)),
)
for (const file of expected) {
  if (!projectEntries.has(file)) errors.push(`${file} missing from compile_commands.json`)
}

for (const [file, entry] of projectEntries) {
  const command = entry.command ?? (entry.arguments ?? []).join(' ')
  const levels = new Set(command.match(/(?:^|\s)-O[0-3sz]?(?=\s|$)/g)?.map((flag) => flag.trim()))
  if (levels.size !== 1) {
    errors.push(`${file}: expected exactly one -O level, got ${[...levels].join(' ') || 'none'}`)
  }
  if (/\bem(?:\+\+|cc)\b/.test(command)) {
    errors.push(`${file}: compiled by Emscripten — this database must come from the native tree`)
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[compile-db] ${error}`)
  process.exit(1)
}
console.log(`[compile-db] OK — ${projectEntries.size} project TUs, one -O level each`)
