#!/usr/bin/env node
/**
 * Post-build check that boot-failure reporting survived the esbuild settings in
 * vite.config.ts (`drop: ['console', 'debugger']` in production). Asserts the
 * `Failed to bootstrap game` literal from src/main.ts is in the entry chunk (a bare
 * `console.error(` check would be satisfied by any dependency) and that no `debugger`
 * statement shipped.
 *
 * Usage: node scripts/check-dist-console.mjs   (after `npx vite build`)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets')

function fail(reason) {
  console.error(`check-dist-console: ${reason}`)
  process.exit(1)
}

if (!statSync(assetsDir, { throwIfNoEntry: false })?.isDirectory()) {
  fail(`missing ${assetsDir} — run \`npx vite build\` first`)
}

// Same heuristic as scripts/check-bundle-size.mjs findChunk: the largest index-*.js is the entry.
const entry = readdirSync(assetsDir)
  .filter((name) => name.startsWith('index-') && name.endsWith('.js'))
  .map((name) => join(assetsDir, name))
  .sort((a, b) => statSync(b).size - statSync(a).size)[0]
if (!entry) fail('no dist/assets/index-*.js entry chunk found')

const code = readFileSync(entry, 'utf8')
if (!code.includes('Failed to bootstrap game')) {
  fail(`"Failed to bootstrap game" is missing from ${entry}: boot errors are stripped from the production bundle`)
}
if (/\bdebugger\b\s*[;}]/.test(code)) {
  fail(`a debugger statement shipped in ${entry}`)
}
console.log(`check-dist-console: ok (${entry})`)
