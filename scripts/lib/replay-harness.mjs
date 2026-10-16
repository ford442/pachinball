/**
 * Replay harness shared by `scripts/verify-replay.mjs` (golden tapes, CI) and
 * `services/replay-verifier` (players' runs, #444 Slice C): serve the game,
 * open it in headless Chromium on the wasm-owner engine, and play a tape
 * through `Game.playReplay` — the spectate path — one
 * `GamePhysicsController.stepFixed` per tape frame, with no presentation.
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BOOT_TIMEOUT_MS = 180_000

/** A port nothing is listening on right now (other dev servers share hosts). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
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
  throw new Error(`server did not answer at ${url} within ${timeoutMs} ms`)
}

/** The Vite dev server on a free 127.0.0.1 port. `close()` stops it. */
export async function startDevServer({ verbose = false } = {}) {
  const port = await freePort()
  // An explicit IPv4 host: `localhost` can resolve to another server on the same port.
  const child = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: repoRoot,
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
  const close = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
  try {
    await waitForServer(base, BOOT_TIMEOUT_MS)
  } catch (err) {
    close()
    throw new Error(`${err.message}\n${log.slice(-2000)}`)
  }
  return { base, close }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * A production build (`dist/`) on a free 127.0.0.1 port: plain static files,
 * no isolation headers (the verifier runs the in-process owner).
 */
export async function serveDist(distDir) {
  const rootDir = path.resolve(distDir)
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://verifier.local')
    let rel = decodeURIComponent(url.pathname)
    if (rel.endsWith('/')) rel += 'index.html'
    const file = path.resolve(rootDir, `.${rel}`)
    if (file !== rootDir && !file.startsWith(rootDir + path.sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  const port = await freePort()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

export function launchBrowser() {
  return chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
  })
}

/**
 * Runs inside the page. Must be self-contained: Playwright serialises it.
 * `mode` 'record' plays the scenario's scripted input on a fresh game and
 * returns the recorder's payload; 'verify' plays `replay` through the spectate
 * path. Both apply the scenario's setup between startGame and the first step,
 * so frame 0 is the same world either way. A failure carries a `code`:
 * boot | start | setup | record | rejected | snapshot | incomplete.
 */
async function runInPage({ mode, scenario, replay }) {
  const fail = (code, reason, extra = {}) => ({ ok: false, code, reason, ...extra })
  const g = window.game
  if (!g?.physicsController || !g.engine || !g.stateManager) return fail('boot', 'window.game hooks missing')
  const wasm = g.physics?.getWasmEngine?.()
  if (!g.physics?.isWasmOwnerMode?.() || !wasm?.isReady) {
    return fail('boot', `not on the wasm-owner engine (mode ${g.physics?.getWasmMode?.() ?? 'unknown'})`)
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
  if (!g.stateManager.isPlaying()) return fail('start', 'the game did not reach PLAYING')

  for (const step of scenario.setup ?? []) {
    const ball = g.ballManager?.getBallBody?.()
    if (step.action === 'adventureTrack') {
      const camera = g.scene?.activeCamera
      if (!g.adventureMode || !ball || !camera) return fail('setup', 'adventure mode, ball or camera missing')
      await g.adventureMode.start(ball, camera, undefined, step.track)
      if (!g.adventureMode.isActive()) return fail('setup', `track ${step.track} did not start`)
    } else if (step.action === 'ontoBumper') {
      // As replay-seed-determinism.spec.ts: drop the ball onto a bumper so the tape scores.
      const bumper = g.gameObjects?.getBumperVisuals?.()?.[step.index ?? 0]
      if (!bumper || !ball) return fail('setup', 'bumper or ball missing')
      const p = bumper.mesh.position
      ball.setTranslation({ x: p.x, y: p.y + 0.3, z: p.z + 0.9 }, true)
      ball.setLinvel({ x: step.vel[0], y: step.vel[1], z: step.vel[2] }, true)
    } else if (step.action === 'multiball') {
      const res = g.ballManager?.startMultiball?.(step.balls)
      if (!res?.started) return fail('setup', 'multiball did not start')
    } else if (step.action === 'magSpinDrop') {
      const feeder = g.magSpinFeeder
      if (!feeder || !ball) return fail('setup', 'MagSpin feeder or ball missing')
      feeder.setGameplayEnabled(true)
      const well = feeder.getPosition()
      ball.setTranslation({ x: well.x + 0.3, y: 0.5, z: well.z + 0.3 }, true)
      ball.setLinvel({ x: 0, y: 0, z: 0 }, true)
      ball.setAngvel({ x: 0, y: 0, z: 0 }, true)
    } else {
      return fail('setup', `unknown setup action ${step.action}`)
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
    if (!g.replayRecorder.isRecording()) return fail('record', `the game ended at step ${steps}; shorten the scenario`)
    payload = g.replayRecorder.stop(g.score)
    payload = { ...payload, frames: [] }
    const wantCascade = scenario.cascade?.freeSeed ?? null
    if ((payload.cascade?.seed ?? null) !== wantCascade) {
      return fail('record', `recorded cascade ${JSON.stringify(payload.cascade ?? null)}, scenario wants free seed ${wantCascade}`)
    }
  } else {
    const runner = g.replayRunner
    const total = runner.getProgress().totalFrames
    while (runner.isPlaying() && runner.getProgress().currentFrame < total && g.stateManager.isPlaying()) {
      controller.stepFixed(null, g.inputActions, runner, null)
    }
    steps = runner.getProgress().currentFrame
    const rejection = runner.getRejection()
    if (rejection) return fail('rejected', `replay rejected: ${rejection.message}`, { outcome: rejection.outcome })
    const snap = controller.getLastReplaySnapshotResult()
    if (snap?.outcome !== 'restored') {
      return fail('snapshot', `frame-0 snapshot ${snap?.outcome ?? 'never checked'}: ${snap?.message ?? ''}`, {
        outcome: snap?.outcome ?? null,
      })
    }
    if (steps !== total) {
      return fail('incomplete', `played ${steps} of ${total} tape frames (game state ${g.stateManager.getState?.()})`, {
        score: g.score,
        steps,
      })
    }
  }

  return {
    ok: true,
    finalStateHash: (await wasm.getStateHash()) ?? null,
    score: g.score,
    steps,
    payload,
  }
}

/**
 * Open a fresh page and run one tape (`{ scenario, replay }`). Never throws:
 * a browser / navigation failure comes back as `{ ok: false, code: 'harness' }`.
 */
export async function runTape(browser, base, mode, tape, { verbose = false } = {}) {
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
    return { ok: false, code: 'harness', reason: `${err instanceof Error ? err.message.split('\n')[0] : String(err)}${pageErrors}` }
  } finally {
    await context.close()
  }
}
