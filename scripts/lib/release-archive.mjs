/**
 * Released builds for the replay verifier (#490 Slice B). A run replays on
 * the physics binary it was played on, so the storage host keeps every
 * released build — one directory per build id, `npm run release:archive` —
 * and each archived build carries its own golden tapes, so a later change
 * (a re-recorded corpus, a Chromium upgrade on the host) cannot silently
 * stop old runs from verifying: `npm run verify:replay -- --releases <dir>`.
 *
 *   <builds>/<buildId>/               the `npm run build` dist, as shipped
 *   <builds>/<buildId>/release.json   { buildId, wasmSha256, archivedAt, chromium, tapes }
 *   <builds>/<buildId>/release-tapes/ tests/replays/*.json as they were at the release
 */

import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { goldenDiffs, inspectBuild, PARTIAL_MARK, RELEASE_FILE, RELEASE_TAPES, tapeFiles, WASM_FILE } from './build-info.mjs'
import { launchBrowser, repoRoot, runTape, serveDist } from './replay-harness.mjs'

export { listReleases } from './build-info.mjs'

/**
 * Replay a build's golden tapes (`<dir>/release-tapes/`, or `tapesDir`) on
 * that build. Resolves `{ build, results: [{ file, ok, reason?, diffs? }] }`;
 * `ok` per tape when it lands on its golden.
 */
export async function checkRelease(dir, { browser, tapesDir, verbose = false } = {}) {
  const build = inspectBuild(dir)
  if (!build) throw new Error(`${dir}: no build-info.json`)
  if (build.problem) throw new Error(`${dir}: ${build.problem}`)
  const files = tapeFiles(tapesDir ?? path.join(dir, RELEASE_TAPES))
  if (files.length === 0) throw new Error(`${dir}: no golden tapes to replay`)
  const ownBrowser = !browser
  browser ??= await launchBrowser()
  const server = await serveDist(dir)
  const results = []
  try {
    for (const file of files) {
      const tape = JSON.parse(readFileSync(file, 'utf8'))
      const name = path.basename(file)
      if (!tape.golden) {
        results.push({ file: name, ok: false, reason: 'tape has no golden' })
        continue
      }
      const res = await runTape(browser, server.base, 'verify', tape, { verbose })
      if (!res.ok) {
        results.push({ file: name, ok: false, reason: res.reason })
        continue
      }
      const diffs = goldenDiffs(tape.golden, res)
      results.push({ file: name, ok: diffs.length === 0, ...(diffs.length ? { diffs } : {}) })
    }
  } finally {
    await server.close()
    if (ownBrowser) await browser.close()
  }
  return { build, results }
}

/**
 * Archive `dist` as a released build under `to/<buildId>/` with the golden
 * corpus (`tapesDir`, default tests/replays), after replaying every tape on
 * the copy: a build that does not reproduce its goldens is not archived.
 * Idempotent for a build already archived with the same binary; refuses a
 * build id archived with another binary, a dirty tree (unless `allowDirty`)
 * and a build without a physics binary.
 */
export async function archiveRelease({ dist, to, tapesDir = path.join(repoRoot, 'tests', 'replays'), allowDirty = false, verbose = false }) {
  const build = inspectBuild(dist)
  if (!build) throw new Error(`${dist}: no build-info.json (run \`npm run build\`)`)
  if (build.problem) throw new Error(`${dist}: ${build.problem} (build order: run \`npm run build\`)`)
  if (!build.wasmSha256) throw new Error(`${dist}: no ${WASM_FILE}: a Rapier-only build cannot verify runs`)
  if (!allowDirty && (build.id === 'unknown' || build.id.endsWith('-dirty'))) {
    throw new Error(`build ${build.id} is not a clean commit: release from a clean tree (or pass --allow-dirty)`)
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(build.id)) throw new Error(`build id ${JSON.stringify(build.id)} is not a directory name`)

  const dest = path.join(to, build.id)
  if (existsSync(dest)) {
    const held = inspectBuild(dest)
    if (held?.wasmSha256 !== build.wasmSha256) {
      throw new Error(`build ${build.id} is already archived with another binary (${held?.wasmSha256?.slice(0, 12) ?? 'none'}, this one ${build.wasmSha256.slice(0, 12)})`)
    }
    if (existsSync(path.join(dest, RELEASE_FILE))) return { status: 'already-archived', dir: dest, build }
  }

  const staging = `${dest}${PARTIAL_MARK}${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(dist, staging, { recursive: true })
  const tapes = path.join(staging, RELEASE_TAPES)
  mkdirSync(tapes, { recursive: true })
  for (const file of tapeFiles(tapesDir)) cpSync(file, path.join(tapes, path.basename(file)))

  const browser = await launchBrowser()
  try {
    const { results } = await checkRelease(staging, { browser, verbose })
    const failed = results.filter((r) => !r.ok)
    if (failed.length) {
      throw new Error(`build ${build.id} does not reproduce its golden tapes: ${failed.map((r) => `${r.file}: ${r.reason ?? r.diffs.join('; ')}`).join(' | ')}`)
    }
    const release = {
      buildId: build.id,
      wasmSha256: build.wasmSha256,
      archivedAt: new Date().toISOString(),
      chromium: browser.version(),
      tapes: results.map((r) => r.file),
    }
    writeFileSync(path.join(staging, RELEASE_FILE), `${JSON.stringify(release, null, 2)}\n`)
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    throw err
  } finally {
    await browser.close()
  }
  rmSync(dest, { recursive: true, force: true })
  renameSync(staging, dest)
  return { status: 'archived', dir: dest, build }
}
