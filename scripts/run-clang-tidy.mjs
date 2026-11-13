#!/usr/bin/env node
/**
 * clang-tidy over the C++ physics engine (#520 §5): every native/src TU but
 * the Emscripten-only bindings.cpp, plus the libFuzzer harnesses in
 * native/fuzz, against native/build-native/compile_commands.json. Checks live
 * in native/.clang-tidy (WarningsAsErrors: '*'), so any diagnostic fails.
 *
 *   npm run compile-db && npm run lint:native
 *   CLANG_TIDY=clang-tidy-18 npm run lint:native   # pick the binary (CI)
 *
 * The fuzz harnesses are not in the database; clang-tidy infers their flags
 * from the nearest native/src entry, which carries the same -I and -std.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'native/build-native')
const tidy = process.env.CLANG_TIDY || 'clang-tidy'

if (!existsSync(join(buildDir, 'compile_commands.json'))) {
  console.error('[lint:native] native/build-native/compile_commands.json missing — run `npm run compile-db`')
  process.exit(1)
}

const sources = (dir, keep) =>
  readdirSync(join(root, dir))
    .filter((name) => name.endsWith('.cpp') && keep(name))
    .sort()
    .map((name) => join(root, dir, name))
const files = [
  ...sources('native/src', (name) => name !== 'bindings.cpp'),
  ...sources('native/fuzz', () => true),
]

function run(file) {
  return new Promise((resolveRun) => {
    const child = spawn(tidy, ['-p', buildDir, '--quiet', file], { cwd: root })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    child.on('error', (err) => resolveRun({ file, code: 1, out: `${tidy}: ${err.message}\n` }))
    child.on('close', (code) => resolveRun({ file, code: code ?? 1, out }))
  })
}

const queue = [...files]
const results = []
const workers = Array.from({ length: Math.min(availableParallelism(), queue.length) }, async () => {
  for (let file = queue.shift(); file; file = queue.shift()) results.push(await run(file))
})
await Promise.all(workers)

// The same header diagnostic is reported once per TU that includes it.
const diagnostics = new Set()
let failed = 0
for (const { file, code, out } of results) {
  const lines = out.split('\n').filter((line) => /\b(warning|error):/.test(line))
  for (const line of lines) diagnostics.add(line.replace(`${root}/`, ''))
  if (code !== 0 && lines.length === 0) {
    failed++
    console.error(`[lint:native] ${relative(root, file)}: clang-tidy exited ${code}\n${out}`)
  }
}
for (const line of [...diagnostics].sort()) console.error(line)

if (diagnostics.size > 0 || failed > 0) {
  console.error(`[lint:native] ${diagnostics.size} diagnostic(s) in ${files.length} files`)
  process.exit(1)
}
console.log(`[lint:native] OK — ${files.length} files clean (${tidy})`)
