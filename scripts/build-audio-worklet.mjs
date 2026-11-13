#!/usr/bin/env node
/**
 * Bundle the pachinko voice AudioWorklet processor (src/audio/pachinko-voice-processor.ts) into
 * public/audio/pachinko-voice-processor.js. An AudioWorklet module loads as a classic script
 * outside the Vite graph, so the script in public/ is build output (IIFE, no imports), never the
 * source: nothing under public/audio/ is hand-written JavaScript.
 *
 * Usage:
 *   node scripts/build-audio-worklet.mjs           # write the script
 *   node scripts/build-audio-worklet.mjs --check   # fail if the committed script differs from the TS
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'src', 'audio', 'pachinko-voice-processor.ts')
const outfile = join(root, 'public', 'audio', 'pachinko-voice-processor.js')

const BANNER =
  '// GENERATED from src/audio/pachinko-voice-processor.ts by scripts/build-audio-worklet.mjs.\n' +
  '// Do not edit: `npm run build:worklet` rewrites this file, `npm run check:worklet` fails on drift.'

export async function bundleWorklet() {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    platform: 'neutral',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    banner: { js: BANNER },
    outfile,
  })
  const file = result.outputFiles?.[0]
  if (!file) throw new Error('esbuild produced no output')
  return file.text
}

function readCommitted() {
  return statSync(outfile, { throwIfNoEntry: false }) ? readFileSync(outfile, 'utf8') : null
}

const check = process.argv.includes('--check')
const generated = await bundleWorklet()

if (check) {
  if (readCommitted() !== generated) {
    console.error(
      'check:worklet FAILED: public/audio/pachinko-voice-processor.js is not the build of ' +
        'src/audio/pachinko-voice-processor.ts. Run `npm run build:worklet` and commit the result.',
    )
    process.exit(1)
  }
  console.log('check:worklet OK: public/audio/pachinko-voice-processor.js matches its TypeScript source.')
} else {
  writeFileSync(outfile, generated)
  console.log(`build:worklet: wrote ${outfile.slice(root.length + 1)} (${generated.length} bytes)`)
}
