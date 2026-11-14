/**
 * Replay a tape in Node, without Babylon (#528).
 *
 * One fixed step is a function: one input row, one wasm `step`, one TypeScript tick. This runs that
 * function on a `HeadlessHost` — the same `SimPhysicsController` tick, scoring, ball manager and
 * table authoring the game runs, around the build's own `PhysicsModule.wasm` — and reports what
 * the Chromium harness (`scripts/lib/replay-harness.mjs`, `runInPage`) reports for the same tape:
 * `{ ok, finalStateHash, score, steps, ghost }`, or `{ ok: false, code, reason }` with the same
 * codes, plus `unsupported` when the tape reaches gameplay that still lives in a presentation
 * class (see `HeadlessGuard`). The verifier treats `unsupported` as "ask Chromium".
 *
 * Built as a self-contained ES module (`scripts/lib/sim-bundle.mjs` → `dist/sim/node-replay.mjs`,
 * and on the fly for `npm run verify:replay:node`); `scripts/check-sim-bundle.mjs` fails the build
 * if it ever pulls in `@babylonjs/*`.
 */

import { ReplayRecorder, type ReplayPayload } from '../replay/replay-recorder'
import { resetDailyCascadeState } from '../cascade/daily-cascade-state'
import { WasmPhysicsEngine } from '../wasm/PhysicsModule'
import type { WasmPhysicsModule } from '../wasm/wasm-types'
import { HeadlessHost } from './headless-host'
import { NodeReplayUnsupported } from './headless-guard'

/** One golden / submitted tape: the payload, and (golden tapes) the scenario's setup steps. */
export interface NodeReplayTape {
  replay: ReplayPayload | string | object
  scenario?: { setup?: ReadonlyArray<{ action: string; index?: number; vel?: [number, number, number]; balls?: number }> }
}

export interface NodeReplayOptions {
  /** The Emscripten factory of the build's `PhysicsModule.js` (the module the tape names). */
  moduleFactory: () => Promise<WasmPhysicsModule>
  /** Sample the primary ball every `ghostStride` steps (the race ghost); 0 = none. */
  ghostStride?: number
  /** Self-test only: the first contact handler throws (a sim fault the strict playback rejects). */
  throwOnContact?: boolean
}

export type NodeReplayFailureCode =
  | 'boot' | 'start' | 'setup' | 'rejected' | 'snapshot' | 'incomplete' | 'unsupported'

export type NodeReplayResult =
  | {
      ok: true
      finalStateHash: string | null
      score: number
      steps: number
      ghost: { stride: number; samples: number; track: string } | null
      /** The C++ static table this run was built on (16 hex), for diagnostics. */
      staticHash: string | null
    }
  | { ok: false; code: NodeReplayFailureCode; reason: string; outcome?: string | null; score?: number; steps?: number }

const INT32_MIN = -2147483648

function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/**
 * Replay `tape` from frame 0 to its last row. Never throws for a tape problem: every failure comes
 * back as `{ ok: false, code }`. Module singletons the game resets per `Game` are reset per run, so
 * one process can replay many tapes (the verifier does).
 */
export async function replayTapeInNode(tape: NodeReplayTape, options: NodeReplayOptions): Promise<NodeReplayResult> {
  const fail = (code: NodeReplayFailureCode, reason: string, extra: Record<string, unknown> = {}): NodeReplayResult =>
    ({ ok: false, code, reason, ...extra })

  let payload: ReplayPayload
  try {
    payload = ReplayRecorder.fromJSON(typeof tape.replay === 'string' ? tape.replay : JSON.stringify(tape.replay))
  } catch (err) {
    return fail('start', `unreadable replay payload: ${err instanceof Error ? err.message : String(err)}`)
  }

  // A fresh page's state: the player's cascade selection is the default one.
  resetDailyCascadeState()

  const engine = new WasmPhysicsEngine()
  await engine.load('PhysicsModule.js', await options.moduleFactory())
  if (!engine.isReady) return fail('boot', 'the C++ physics bundle did not load')

  let host: HeadlessHost
  try {
    host = new HeadlessHost(engine)
  } catch (err) {
    return fail('boot', `headless table: ${err instanceof Error ? err.message : String(err)}`)
  }
  const unsupported = (): NodeReplayResult =>
    fail('unsupported', host.guard.reason ?? 'unsupported', { score: host.score, steps: host.replayRunner.getProgress().currentFrame })

  // Verification playback (#503 A3): a physics / sim fault rejects the tape.
  host.replayRunner.setStrict(true)
  try {
    await host.playReplay(payload)
  } catch (err) {
    if (err instanceof NodeReplayUnsupported || host.guard.reason) return unsupported()
    return fail('start', `the replay did not start: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!host.stateManager.isPlaying()) return fail('start', 'the game did not reach PLAYING')

  // As the harness's self-test hook: the first contact handler throws.
  if (options.throwOnContact) host.physicsController.injectContactFaultOnce()

  for (const step of tape.scenario?.setup ?? []) {
    const ball = host.ballManager.getBallBody()
    if (step.action === 'ontoBumper') {
      // As replay-harness.mjs: the ball above and in front of a bumper (its mesh sits on its body).
      const bumper = host.bumperBody(step.index ?? 0)
      if (!bumper || !ball || !step.vel) return fail('setup', 'bumper or ball missing')
      const p = bumper.translation()
      ball.setTranslation({ x: p.x, y: p.y + 0.3, z: p.z + 0.9 }, true)
      ball.setLinvel({ x: step.vel[0], y: step.vel[1], z: step.vel[2] }, true)
    } else if (step.action === 'multiball') {
      const res = host.ballManager.startMultiball(step.balls ?? 0)
      if (!res.started) return fail('setup', 'multiball did not start')
    } else {
      return fail('unsupported', `setup action ${step.action} (adventure tracks and feeder drops replay in Chromium)`)
    }
    host.rebuildHandleCaches()
  }

  const controller = host.physicsController
  const runner = host.replayRunner
  const total = runner.getProgress().totalFrames
  const ghostStride = options.ghostStride ?? 0
  const track: number[] = []
  while (runner.isPlaying() && runner.getProgress().currentFrame < total && host.stateManager.isPlaying()) {
    try {
      controller.stepFixed(null, host.inputActions, runner, null)
    } catch (err) {
      if (host.guard.reason) return unsupported()
      host.onSimFault({ phase: 'physics', name: 'fixed-step', message: err instanceof Error ? err.message : String(err) })
      if (runner.isPlaying()) runner.reject('sim-fault', `physics/fixed-step: ${String(err)}`)
      break
    }
    // A guard trip inside a contact handler is caught there (per-contact isolation); it still ends the run.
    if (host.guard.reason) return unsupported()
    if (ghostStride && (runner.getProgress().currentFrame - 1) % ghostStride === 0) {
      const p = host.ballManager.getBallBody()?.translation()
      if (p) track.push(Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000))
      else track.push(INT32_MIN, 0, 0)
    }
  }
  const steps = runner.getProgress().currentFrame

  const rejection = runner.getRejection()
  if (rejection) return fail('rejected', `replay rejected: ${rejection.message}`, { outcome: rejection.outcome })
  const snap = controller.getLastReplaySnapshotResult()
  if (snap?.outcome !== 'restored') {
    return fail('snapshot', `frame-0 snapshot ${snap?.outcome ?? 'never checked'}: ${snap?.message ?? ''}`, { outcome: snap?.outcome ?? null })
  }
  if (steps !== total) {
    return fail('incomplete', `played ${steps} of ${total} tape frames (game state ${host.stateManager.getState()})`, { score: host.score, steps })
  }

  return {
    ok: true,
    finalStateHash: engine.getStateHash() ?? null,
    score: host.score,
    steps,
    ghost: ghostStride
      ? { stride: ghostStride, samples: track.length / 3, track: base64Of(new Uint8Array(Int32Array.from(track).buffer)) }
      : null,
    staticHash: engine.getStaticContentHash() ?? null,
  }
}
