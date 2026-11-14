/**
 * Game Physics Controller — the rendered game's physics controller: `SimPhysicsController` (the
 * fixed step and everything one tick runs, Babylon-free, #528) plus what only a drawn table needs.
 *
 * - mesh interpolation: the pose before each tick is snapshotted, and every render frame blends
 *   the meshes from it to the live pose (`mesh-interpolation.ts`);
 * - `sim-phase.ts` — `updateSim`, the frame scheduler's `sim` phase;
 * - `visual-phase.ts` — `updateVisuals`, the `visuals` phase;
 * - the replay ghost, placed where the primary ball is drawn.
 */

import type { PhysicsHost } from './types'
import { MeshInterpolationSystem } from './mesh-interpolation'
import { updateSimPhase } from './sim-phase'
import { VisualPhase } from './visual-phase'
import { SimPhysicsController } from './sim-physics-controller'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { PhysicsBody } from '../../core/physics-api'
import type { InputFrame, ReplayRecorder, ReplayRunner } from '../../game-elements'

export type { StepInputActions } from './sim-physics-controller'
import type { StepInputActions } from './sim-physics-controller'

// Scratch vector for the per-frame ghost placement; the ghost renderer copies what it keeps.
const scratchGhostPos = new Vector3()

export class GamePhysicsController extends SimPhysicsController {
  private readonly meshInterpolation = new MeshInterpolationSystem()
  private readonly visualPhase: VisualPhase

  constructor(host: PhysicsHost) {
    super(host)
    this.visualPhase = new VisualPhase(host, this.meshInterpolation, this.frame)
  }

  protected override capturePreStep(): void {
    this.meshInterpolation.capturePreStep(this.host.gameObjects?.getBindings() || [])
  }

  /** Delegates mesh interpolation to MeshInterpolationSystem (see `SimPhysicsController.syncMeshes`). */
  protected override syncMeshes(alpha: number, snap = false): void {
    super.syncMeshes(alpha, snap)
    this.meshInterpolation.syncMeshes(alpha, this.host.gameObjects?.getBindings() || [], snap)
  }

  /** Put the ghost ball where the primary ball is drawn this frame (after the mesh sync, same blend). */
  protected override placeGhost(): void {
    const ghost = this.host.ghostBallRenderer
    if (!ghost?.isVisible()) return
    const pos = this.getBallPosition(scratchGhostPos)
    if (pos) ghost.updatePosition(pos)
  }

  /**
   * One render frame of the table: the fixed step, then the sim and visual updates that follow it.
   * The frame scheduler runs the three parts in its `physics`, `sim` and `visuals` phases
   * (`stepFixed`, `updateSim`, `updateVisuals`); this composition keeps the old single entry point
   * for callers that drive the table directly (tests, tools).
   */
  stepPhysics(
    inputManager: { update: () => void; processBufferedInputs: () => InputFrame | null } | null,
    inputActions: StepInputActions | null,
    replayRunner?: ReplayRunner | null,
    replayRecorder?: ReplayRecorder | null
  ): void {
    this.stepFixed(inputManager, inputActions, replayRunner, replayRecorder)
    this.updateSim()
    this.updateVisuals()
  }

  /** Frame-scheduler `sim` phase (`sim-phase.ts`). */
  updateSim(): void {
    updateSimPhase(this.host, this.meshInterpolation, this.frame)
  }

  /** Frame-scheduler `visuals` phase (`visual-phase.ts`). */
  updateVisuals(): void {
    this.visualPhase.update()
  }

  getBallMeshForBody(body: PhysicsBody): Mesh | null {
    return this.collisionDispatcher.getBallMeshForBody(body)
  }

  /** The primary ball as its mesh is drawn this frame (interpolated), written into `out`; null if there is no ball. */
  getBallPosition(out: Vector3): Vector3 | null {
    const body = this.host.ballManager?.getBallBody()
    if (!body) return null
    return this.meshInterpolation.getInterpolatedPosition(body, this.frame.alpha, out)
  }
}
