#!/usr/bin/env node
/**
 * Archive the build just deployed for the replay verifier (#490 Slice B):
 * copies `dist/` to `<builds>/<buildId>/` with the golden tapes, after
 * replaying each tape on the copy (scripts/lib/release-archive.mjs). Run it
 * on the storage host after every deploy, so runs played on this release's
 * `PhysicsModule.wasm` keep verifying after the next one ships.
 *
 *   npm run release:archive -- --to /srv/pachinball-builds
 *   npm run release:archive -- --to <dir> --dist <dir> --tapes <dir> --allow-dirty --verbose
 *
 * `--to` defaults to $VERIFIER_BUILDS, `--tapes` to tests/replays. Exits 1 when the build does not
 * reproduce its goldens, is dirty, has no physics binary, or its build id is
 * already archived with another binary.
 */

import path from 'node:path'
import { repoRoot } from './lib/replay-harness.mjs'
import { archiveRelease } from './lib/release-archive.mjs'

function parseArgs(argv) {
  const opts = {
    to: process.env.VERIFIER_BUILDS ?? null,
    dist: path.join(repoRoot, 'dist'),
    tapesDir: path.join(repoRoot, 'tests', 'replays'),
    allowDirty: false,
    verbose: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--to') opts.to = argv[++i]
    else if (a === '--dist') opts.dist = argv[++i]
    else if (a === '--tapes') opts.tapesDir = argv[++i]
    else if (a === '--allow-dirty') opts.allowDirty = true
    else if (a === '--verbose') opts.verbose = true
    else throw new Error(`unknown argument ${a}`)
  }
  if (!opts.to) throw new Error('--to <builds dir> (or VERIFIER_BUILDS) is required')
  return { ...opts, to: path.resolve(opts.to), dist: path.resolve(opts.dist), tapesDir: path.resolve(opts.tapesDir) }
}

try {
  const opts = parseArgs(process.argv.slice(2))
  const started = Date.now()
  const { status, dir, build } = await archiveRelease(opts)
  console.log(JSON.stringify({ status, dir, buildId: build.id, wasmSha256: build.wasmSha256, ms: Date.now() - started }))
} catch (err) {
  console.error(`release:archive FAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
