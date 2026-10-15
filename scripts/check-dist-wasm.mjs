#!/usr/bin/env node
/**
 * Assert dist/wasm/ carries exactly the WASM bundle that public/wasm/ holds
 * (#464 item 1). `vite build` copies public/ into dist/ and the Workbox
 * precache manifest hashes what it copied, so a WASM build that runs after
 * Vite ships (and precaches) the previous binary.
 *
 * Usage:
 *   node scripts/check-dist-wasm.mjs                 # fail unless identical
 *   ALLOW_NO_WASM=1 node scripts/check-dist-wasm.mjs # Rapier-only builds: no public/wasm is fine
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public', 'wasm')
const distDir = join(root, 'dist', 'wasm')
const FILES = ['PhysicsModule.wasm', 'PhysicsModule.js']

function isDir(path) {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true
}

function fail(reason) {
  console.error(`check:dist-wasm FAILED: ${reason}`)
  process.exit(1)
}

if (!isDir(publicDir)) {
  if (process.env.ALLOW_NO_WASM === '1') {
    console.log('check:dist-wasm: no WASM bundle: Rapier-only build (ALLOW_NO_WASM=1), skipping')
    process.exit(0)
  }
  fail('no WASM bundle: Rapier-only build (public/wasm is missing; run `npm run build:wasm`, or set ALLOW_NO_WASM=1)')
}
if (!isDir(join(root, 'dist'))) fail('dist/ is missing; run `npm run build` first')

for (const name of FILES) {
  const src = join(publicDir, name)
  const out = join(distDir, name)
  if (!statSync(src, { throwIfNoEntry: false })?.isFile()) fail(`public/wasm/${name} is missing`)
  if (!statSync(out, { throwIfNoEntry: false })?.isFile()) fail(`dist/wasm/${name} is missing`)
  if (!readFileSync(src).equals(readFileSync(out))) {
    fail(`dist/wasm/${name} differs from public/wasm/${name}: dist was built before the WASM bundle (build order)`)
  }
}

console.log(`check:dist-wasm OK: dist/wasm matches public/wasm (${FILES.join(', ')})`)
