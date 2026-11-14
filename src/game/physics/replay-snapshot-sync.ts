/**
 * Frame-0 world snapshot sync (#422): recording fingerprints the world once frame 0 is on the tape;
 * playback restores that snapshot, and says so on screen when it cannot.
 *
 * Split out of `physics-controller.ts`. `GamePhysicsController.runTick` calls `sync()` at the one
 * point both sides agree on: after this frame's inputs have driven flippers / movers, right before
 * the step.
 */

import type { PhysicsHost } from './types'
import type { WasmOwner } from './wasm-owner'
import type { GameSimClock } from '../../core/sim-clock'
import type { ReplayRecorder, ReplayRunner } from '../../game-elements'
import {
  applyReplaySnapshot,
  captureReplayFingerprint,
  linkedBodyIds,
  NO_SNAPSHOT_ENGINE,
  showReplayDivergenceToast,
  type ReplaySnapshotResult,
} from '../../replay/replay-snapshot'

export class ReplaySnapshotSync {
  private lastReplaySnapshot: ReplaySnapshotResult | null = null

  constructor(
    private readonly host: PhysicsHost,
    private readonly simClock: GameSimClock,
    /** The C++ owner as of now: it is rebuilt (and replaced) by `rebuildHandleCaches`. */
    private readonly getOwner: () => WasmOwner | null,
  ) {}

  /** Outcome of the last replay's frame-0 snapshot check (null until a replay plays). */
  getLast(): ReplaySnapshotResult | null {
    return this.lastReplaySnapshot
  }

  /**
   * Frame-0 world snapshot (#422), taken and restored at the same point: after
   * this frame's inputs have driven flippers / movers, right before the step.
   * Recording fingerprints the world once frame 0 is on the tape; playback
   * restores that snapshot, and says so on screen when it cannot.
   */
  sync(isOwner: boolean, runner: ReplayRunner | null, recorder: ReplayRecorder | null): void {
    const engine = isOwner ? this.host.physics.getWasmEngine?.() ?? null : null
    const world = isOwner ? this.host.physics.getWasmTableWorld?.() ?? null : null
    if (recorder?.isRecording() && recorder.getFrameCount() > 0 && !recorder.hasWorldFingerprint()) {
      recorder.attachWorldFingerprint(captureReplayFingerprint(engine, world))
    }
    const check = runner?.isPlaying() ? runner.takeSnapshotCheck() : null
    if (!check) return
    // The spectator's ids were allocated by its own earlier games; when they
    // differ from the recording's, the restore renames the C++ bodies and the
    // TS links follow (#441).
    const live = { bodyIds: linkedBodyIds(world), hinges: this.getOwner()?.getFlipperHinges() ?? [] }
    const res = applyReplaySnapshot(engine ?? NO_SNAPSHOT_ENGINE, live, check, (remap) => {
      world?.renameLinkedIds(remap.bodies)
      this.getOwner()?.renameIds(remap.bodies, remap.hinges)
    })
    this.lastReplaySnapshot = res
    // Bodies that do not pair up by role mean the table descriptors differ:
    // refuse the replay instead of letting a ghost drift under a toast (#444).
    if (res.outcome === 'id-layout') runner?.reject(res.outcome, res.message ?? res.outcome)
    // The restore moved the engine's step counter to the recorder's; the
    // gameplay clock carries on from where it was. (The worker client already
    // reports the snapshot's counter while its restore is in flight.)
    if (res.outcome === 'restored') this.simClock.resync(this.host.physics)
    showReplayDivergenceToast(res)
    // Worker path: the status arrives with the worker's reply.
    void res.settled?.then((final) => {
      if (this.lastReplaySnapshot !== res) return
      this.lastReplaySnapshot = final
      if (final.outcome !== 'restored') {
        // Refused: the world (and its counter) were left as they were.
        this.simClock.resync(this.host.physics)
        showReplayDivergenceToast(final)
      }
    })
  }
}
