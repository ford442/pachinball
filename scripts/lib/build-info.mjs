/**
 * Builds as the replay verifier sees them (#490 Slice B) — plain fs, no
 * browser, so tests/replay-verifier-builds.test.ts runs it in Vitest.
 *
 * A build is a `npm run build` dist: `build-info.json` ({ buildId,
 * wasmSha256 }) and the physics binary it ships, `wasm/PhysicsModule.wasm`.
 * Archived releases (scripts/lib/release-archive.mjs) add `release.json` and
 * their golden tapes in `release-tapes/`.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export const WASM_FILE = path.join('wasm', 'PhysicsModule.wasm')
export const RELEASE_FILE = 'release.json'
export const RELEASE_TAPES = 'release-tapes'
/** Marks a release:archive copy still being checked; never a build to use. */
export const PARTIAL_MARK = '.partial-'
const GOLDEN_KEYS = ['finalStateHash', 'score', 'steps']

/** SHA-256 (hex) of a file, or null when it cannot be read. */
export function sha256File(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

/**
 * `{ id, dir, wasmSha256, problem }`, or null without a build-info.json.
 * `wasmSha256` is the hash of the binary actually on disk (null without
 * one); `problem` says why the build must not be used: its binary is not the
 * one build-info.json declares.
 */
export function inspectBuild(dir) {
  let info
  try {
    info = JSON.parse(readFileSync(path.join(dir, 'build-info.json'), 'utf8'))
  } catch {
    return null
  }
  if (typeof info?.buildId !== 'string' || !info.buildId) return null
  const wasmSha256 = sha256File(path.join(dir, WASM_FILE))
  const declared = typeof info.wasmSha256 === 'string' ? info.wasmSha256 : null
  const problem = declared && declared !== wasmSha256
    ? `${WASM_FILE} hashes to ${wasmSha256?.slice(0, 12) ?? 'nothing'}, build-info.json declares ${declared.slice(0, 12)}`
    : null
  return { id: info.buildId, dir, wasmSha256, problem }
}

/**
 * The builds the verifier can replay on — `{ id, dir, wasmSha256 }`, the
 * default build (`dist`) first, then the archive (`builds`, one directory per
 * build id) newest first — and the default: `dist`, else the newest archived
 * build. A build whose binary differs from the one its build-info.json
 * declares is skipped (`onSkip(build)`); so is a half-written archive copy.
 */
export function discoverBuilds({ dist, builds, onSkip = () => {} }) {
  const found = []
  const add = (build, mtime) => {
    if (!build) return
    if (build.problem) {
      onSkip(build)
      return
    }
    if (!found.some((b) => b.id === build.id)) found.push({ build, mtime })
  }
  if (dist && existsSync(dist)) add(inspectBuild(dist), Infinity)
  if (builds && existsSync(builds)) {
    for (const name of readdirSync(builds)) {
      const dir = path.join(builds, name)
      if (name.includes(PARTIAL_MARK) || !statSync(dir).isDirectory()) continue
      add(inspectBuild(dir), statSync(dir).mtimeMs)
    }
  }
  const list = found
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ build: { id, dir, wasmSha256 } }) => ({ id, dir, wasmSha256 }))
  if (list.length === 0) {
    throw new Error(`no usable build with a build-info.json in ${dist ?? '(no VERIFIER_DIST)'} or ${builds ?? '(no VERIFIER_BUILDS)'}`)
  }
  return { builds: list, fallback: list[0] }
}

/** Golden fields (`finalStateHash`, `score`, `steps`) that differ between a tape's golden and a replay. */
export function goldenDiffs(golden, res) {
  const diffs = []
  for (const key of GOLDEN_KEYS) {
    if (golden?.[key] !== res[key]) diffs.push(`${key} ${JSON.stringify(golden?.[key])} → ${JSON.stringify(res[key])}`)
  }
  return diffs
}

/** `*.json` files in `dir`, sorted; none when it does not exist. */
export function tapeFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(dir, f))
}

/** Directories under `parent` holding an archived release (`release.json`). */
export function listReleases(parent) {
  if (!existsSync(parent)) return []
  return readdirSync(parent)
    .map((name) => path.join(parent, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(path.join(dir, RELEASE_FILE)))
    .sort()
}
