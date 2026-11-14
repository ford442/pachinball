/**
 * Frame-scheduler `sim` phase: what follows the fixed steps once per render frame and does not move
 * the ball or the score — the dynamic world's zone reveal, the map manager, and the jackpot exit for
 * a sequence that ended outside a tick. Gameplay runs per step in `StepGameplay` (#519 A1).
 *
 * Split out of `physics-controller.ts`; `GamePhysicsController.updateSim()` calls it.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { PhysicsFrameState, PhysicsHost } from './types'
import type { MeshInterpolationSystem } from './mesh-interpolation'
import { finishJackpotIfDone } from './step-gameplay'

// Scratch for the per-frame path. `DynamicWorld.update` only reads it.
const scratchBallPos = new Vector3()

export function updateSimPhase(host: PhysicsHost, meshInterpolation: MeshInterpolationSystem, frame: PhysicsFrameState): void {
  // Nothing here may move a body: `dynamicWorld` only steers the camera target and zone
  // visuals. Body-moving updates run per tick (`tickStepMechanisms` / `stepGameplay`).
  if (!frame.stepped) return
  const dt = frame.dt

  // Dynamic world
  const mainBall = host.ballManager?.getBallBody()
  if (host.dynamicWorld && mainBall) {
    host.dynamicWorld.update(meshInterpolation.getInterpolatedPosition(mainBall, frame.alpha, scratchBallPos), dt)
  }

  host.mapManager?.update(dt)

  finishJackpotIfDone(host)
}
