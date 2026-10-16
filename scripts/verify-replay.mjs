#!/usr/bin/env node
/**
 * Headless replay verifier (#444 Slice A).
 *
 * Plays each replay tape in the real game, headless Chromium on the
 * wasm-owner C++ engine, and prints what it reproduced:
 *
 *   { file, finalStateHash, score, steps }
 *
 * The page's render loop is stopped and the verifier calls
 * `GamePhysicsController.stepFixed` once per tape frame (one input frame per
 * physics step), after starting the game through `Game.playReplay` — the
 * spectate path — so the tape drives the game exactly as recorded:
 * frame-0 C++ snapshot restored, production builders, scoring and table
 * mechanics. A tape whose snapshot is refused, or whose numbers differ from
 * its golden, fails the run.
 *
 *   npm run verify:replay                         # every tests/replays/*.json
 *   npm run verify:replay -- tests/replays/a.json # just these
 *   npm run verify:replay -- --update             # write this build's numbers as the goldens
 *   npm run record:replay -- [files]              # re-record tapes from their scenarios
 *
 * --update is for an intentional numeric change (solver, tuning): the
 * goldens move in the same PR with a one-line rationale. --record is for
 * when the tape itself is stale (snapshot version, table geometry): it
 * records each scenario afresh, then verifies the new tape on a fresh page
 * before writing it.
 *
 * Options: --url <base> uses a running server (dev or preview) instead of
 * starting the Vite dev server; --verbose streams the page console and the
 * server log to stderr.
 */

import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPLAY_DIR = path.join(root, 'tests', 'replays')
const BOOT_TIMEOUT_MS = 180_000

function parseArgs(argv) {
  const opts = { mode: 'verify', update: false, url: null, verbose: false, files: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--record') opts.mode = 'record'
    else if (a === '--update') opts.update = true
    else if (a === '--url') opts.url = argv[++i]
    else if (a === '--verbose') opts.verbose = true
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else opts.files.push(path.resolve(a))
  }
  if (opts.files.length === 0) {
    opts.files = readdirSync(REPLAY_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => path.join(REPLAY_DIR, f))
  }
  return opts
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`dev server did not answer at ${url} within ${timeoutMs} ms`)
}

/** A port nothing is listening on right now (other dev servers share this machine). */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

async function startDevServer(verbose) {
  const port = await freePort()
  // An explicit IPv4 host: `localhost` can resolve to another server on the same port.
  const child = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
    detached: true,
  })
  let log = ''
  const onData = (d) => {
    log += d
    if (verbose) process.stderr.write(`[vite] ${d}`)
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  const base = `http://127.0.0.1:${port}`
  try {
    await waitForServer(base, BOOT_TIMEOUT_MS)
  } catch (err) {
    stopDevServer(child)
    throw new Error(`${err.message}\n${log.slice(-2000)}`)
  }
  return { base, child }
}

function stopDevServer(child) {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // already gone
  }
}

/**
 * Runs inside the page. Must be self-contained: Playwright serialises it.
 * `mode` 'record' plays the scenario's scripted input on a fresh game and
 * returns the recorder's payload; 'verify' plays `replay` through the spectate
 * path. Both apply the scenario's setup between startGame and the first step,
 * so frame 0 is the same world either way.
 */
async function runInPage({ mode, scenario, replay }) {
  const fail = (reason) => ({ ok: false, reason })
  const g = window.game
  if (!g?.physicsController || !g.engine || !g.stateManager) return fail('window.game hooks missing')
  const wasm = g.physics?.getWasmEngine?.()
  if (!g.physics?.isWasmOwnerMode?.() || !wasm?.isReady) {
    return fail(`not on the wasm-owner engine (mode ${g.physics?.getWasmMode?.() ?? 'unknown'})`)
  }
  // Nothing steps unless we step it. The loop below calls
  // `GamePhysicsController.stepFixed` — one fixed step of gameplay, no
  // presentation: nothing on screen may change the result, and some cosmetic
  // systems (the LCD table's per-frame texture upload) stall a page whose
  // render loop is stopped.
  g.engine.stopRenderLoop()
  g.engine.getDeltaTime = () => 1000 / 60

  if (mode === 'record') {
    // A cascade scenario's page was opened with `?cascade=<seed>`.
    await g.startGame()
  } else {
    await g.playReplay(replay)
  }
  if (!g.stateManager.isPlaying()) return fail('the game did not reach PLAYING')

  for (const step of scenario.setup ?? []) {
    const ball = g.ballManager?.getBallBody?.()
    if (step.action === 'adventureTrack') {
      const camera = g.scene?.activeCamera
      if (!g.adventureMode || !ball || !camera) return fail('adventure mode, ball or camera missing')
      await g.adventureMode.start(ball, camera, undefined, step.track)
      if (!g.adventureMode.isActive()) return fail(`track ${step.track} did not start`)
    } else if (step.action === 'ontoBumper') {
      // As replay-seed-determinism.spec.ts: drop the ball onto a bumper so the tape scores.
      const bumper = g.gameObjects?.getBumperVisuals?.()?.[step.index ?? 0]
      if (!bumper || !ball) return fail('bumper or ball missing')
      const p = bumper.mesh.position
      ball.setTranslation({ x: p.x, y: p.y + 0.3, z: p.z + 0.9 }, true)
      ball.setLinvel({ x: step.vel[0], y: step.vel[1], z: step.vel[2] }, true)
    } else if (step.action === 'multiball') {
      const res = g.ballManager?.startMultiball?.(step.balls)
      if (!res?.started) return fail('multiball did not start')
    } else if (step.action === 'magSpinDrop') {
      const feeder = g.magSpinFeeder
      if (!feeder || !ball) return fail('MagSpin feeder or ball missing')
      feeder.setGameplayEnabled(true)
      const well = feeder.getPosition()
      ball.setTranslation({ x: well.x + 0.3, y: 0.5, z: well.z + 0.3 }, true)
      ball.setLinvel({ x: 0, y: 0, z: 0 }, true)
      ball.setAngvel({ x: 0, y: 0, z: 0 }, true)
    } else {
      return fail(`unknown setup action ${step.action}`)
    }
    g.physicsController.rebuildHandleCaches()
  }

  const controller = g.physicsController
  let steps = 0
  let payload = null
  if (mode === 'record') {
    const input = scenario.input
    const inWindow = (phase, w) => !!w && phase >= w[0] && phase < w[1]
    const frameAt = (s) => {
      const phase = input.flippers ? s % input.flippers.period : 0
      const launch = (input.launches ?? []).find((l) => l.step === s)
      const nudge = (input.nudges ?? []).find((n) => n.step === s)
      return {
        flipperLeft: inWindow(phase, input.flippers?.left),
        flipperRight: inWindow(phase, input.flippers?.right),
        plungerCharge: launch ? launch.charge : null,
        plunger: !!launch,
        nudge: nudge ? { x: nudge.x, y: 0, z: nudge.z } : null,
        timestamp: s * (1000 / 60),
      }
    }
    const source = { update() {}, processBufferedInputs: () => frameAt(steps++) }
    while (steps < input.steps && g.stateManager.isPlaying()) {
      controller.stepFixed(source, g.inputActions, null, g.replayRecorder)
    }
    if (!g.replayRecorder.isRecording()) return fail(`the game ended at step ${steps}; shorten the scenario`)
    payload = g.replayRecorder.stop(g.score)
    payload = { ...payload, frames: [] }
    const wantCascade = scenario.cascade?.freeSeed ?? null
    if ((payload.cascade?.seed ?? null) !== wantCascade) {
      return fail(`recorded cascade ${JSON.stringify(payload.cascade ?? null)}, scenario wants free seed ${wantCascade}`)
    }
  } else {
    const runner = g.replayRunner
    const total = runner.getProgress().totalFrames
    while (runner.isPlaying() && runner.getProgress().currentFrame < total && g.stateManager.isPlaying()) {
      controller.stepFixed(null, g.inputActions, runner, null)
    }
    steps = runner.getProgress().currentFrame
    const rejection = runner.getRejection()
    if (rejection) return fail(`replay rejected: ${rejection.message}`)
    const snap = controller.getLastReplaySnapshotResult()
    if (snap?.outcome !== 'restored') return fail(`frame-0 snapshot ${snap?.outcome ?? 'never checked'}: ${snap?.message ?? ''}`)
    if (steps !== total) return fail(`played ${steps} of ${total} tape frames (game state ${g.stateManager.getState?.()})`)
  }

  return {
    ok: true,
    finalStateHash: (await wasm.getStateHash()) ?? null,
    score: g.score,
    steps,
    payload,
  }
}

async function runTape(browser, base, mode, tape, verbose) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  if (verbose) page.on('console', (m) => process.stderr.write(`[page] ${m.type()}: ${m.text()}\n`))
  try {
    await page.addInitScript(() => localStorage.setItem('pachinball:physics-engine', 'wasm-owner'))
    // Verify opens the plain page: the cascade table comes from the payload, as when spectating.
    const cascade = mode === 'record' && tape.scenario.cascade ? `&cascade=${tape.scenario.cascade.freeSeed}` : ''
    await page.goto(`${base}/?renderer=webgl2&seed=${tape.scenario.seed}${cascade}`)
    await page.waitForFunction(() => !!window.game?.stateManager && !!window.game?.physicsController, null, {
      timeout: BOOT_TIMEOUT_MS,
    })
    await page.locator('#start-btn').waitFor({ state: 'visible', timeout: BOOT_TIMEOUT_MS })
    const res = await page.evaluate(runInPage, { mode, scenario: tape.scenario, replay: tape.replay })
    if (!res.ok && errors.length) res.reason += ` | page errors: ${errors.slice(0, 3).join(' / ')}`
    return res
  } catch (err) {
    const pageErrors = errors.length ? ` | page errors: ${errors.slice(0, 3).join(' / ')}` : ''
    return { ok: false, reason: `${err instanceof Error ? err.message.split('\n')[0] : String(err)}${pageErrors}` }
  } finally {
    await context.close()
  }
}

function compare(golden, res) {
  const diffs = []
  for (const key of ['finalStateHash', 'score', 'steps']) {
    if (golden?.[key] !== res[key]) diffs.push(`${key} ${JSON.stringify(golden?.[key])} → ${JSON.stringify(res[key])}`)
  }
  return diffs
}

function writeTape(file, tape) {
  writeFileSync(file, `${JSON.stringify(tape, null, 2)}\n`)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const server = opts.url ? null : await startDevServer(opts.verbose)
  const base = opts.url ?? server.base
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  })
  let failed = 0
  try {
    for (const file of opts.files) {
      const name = path.relative(root, file)
      const tape = JSON.parse(readFileSync(file, 'utf8'))
      const started = Date.now()

      if (opts.mode === 'record') {
        const rec = await runTape(browser, base, 'record', tape, opts.verbose)
        if (!rec.ok) {
          failed++
          console.log(JSON.stringify({ file: name, ok: false, reason: `record: ${rec.reason}` }))
          continue
        }
        const recorded = { ...tape, replay: rec.payload }
        // The new tape must reproduce itself on a fresh page before it is kept.
        const check = await runTape(browser, base, 'verify', recorded, opts.verbose)
        const golden = { finalStateHash: rec.finalStateHash, score: rec.score, steps: rec.steps }
        const diffs = check.ok ? compare(golden, check) : [check.reason]
        if (diffs.length) {
          failed++
          console.log(JSON.stringify({ file: name, ok: false, reason: `recorded but did not replay: ${diffs.join('; ')}` }))
          continue
        }
        writeTape(file, { ...recorded, golden })
        console.log(JSON.stringify({ file: name, ok: true, recorded: true, ...golden, ms: Date.now() - started }))
        continue
      }

      const res = await runTape(browser, base, 'verify', tape, opts.verbose)
      if (!res.ok) {
        failed++
        console.log(JSON.stringify({ file: name, ok: false, reason: res.reason }))
        continue
      }
      const out = { finalStateHash: res.finalStateHash, score: res.score, steps: res.steps }
      // Not compared with the tape's own `finalScore`: an --update moves the
      // golden past what the recorder saw; record mode checks the two agree.
      const diffs = compare(tape.golden, res)
      if (diffs.length && opts.update) {
        writeTape(file, { ...tape, golden: out })
        console.log(JSON.stringify({ file: name, ok: true, updated: true, was: tape.golden, ...out }))
        continue
      }
      if (diffs.length) failed++
      console.log(JSON.stringify({ file: name, ok: diffs.length === 0, ...out, ...(diffs.length ? { diffs } : {}), ms: Date.now() - started }))
    }
  } finally {
    await browser.close()
    if (server) stopDevServer(server.child)
  }
  if (failed) {
    console.error(`verify-replay: ${failed} of ${opts.files.length} tape(s) failed`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
