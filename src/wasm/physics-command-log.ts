/**
 * The worker client's recovery log (#503 A2): every command it sent, compacted at checkpoints,
 * so a dead worker's world can be rebuilt in-process.
 *
 * Shape: `prefix` (the world's structure up to the last checkpoint: statics, bodies, hinges and
 * the latest value of every last-write-wins setter — no steps), the checkpoint blob (a
 * `serializeSnapshot()` of the world at that point), then `suffix` (every command since,
 * steps included). Recovery replays `prefix`, restores the blob, replays `suffix`: the
 * structure makes the static hash and id layout match, the blob sets the dynamic state, and the
 * suffix re-runs the last few seconds. Without a checkpoint the whole log is replayed from
 * scratch, which is exact but grows with the session; checkpoints bound it.
 */

import type { PhysicsWorkerCommand } from './physics-worker-protocol'

type Command = PhysicsWorkerCommand

/** Setters whose last value per target is all a rebuilt world needs. */
const LAST_WRITE_WINS = new Set<Command['type']>([
  'setGravity',
  'setRollingResistance',
  'setNextKinematicTransform',
  'setCollisionGroups',
  'setForceFieldEnabled',
  'setForceFieldVector',
  'setVelocity',
  'setAngularVelocity',
  'setBodyPosition',
  'setBodyRotation',
  'setBodyType',
  'setHingeMotor',
])

/**
 * Commands that never belong in the structural prefix: steps and impulses (their effect is in
 * the checkpoint blob), and snapshot requests (a restore before the checkpoint is superseded by
 * it; serialize / hash requests were answered long ago).
 */
const TRANSIENT = new Set<Command['type']>([
  'step',
  'applyForce',
  'applyImpulse',
  'serializeSnapshot',
  'restoreSnapshot',
  'getStateHash',
  'dispose',
])

function targetKey(cmd: Command): string {
  if ('id' in cmd) return `${cmd.type}:${cmd.id}`
  if ('fieldId' in cmd) return `${cmd.type}:${cmd.fieldId}`
  return cmd.type
}

/** A copy that survives the original's buffers being transferred to the worker. */
export function cloneCommandForLog(cmd: Command): Command {
  switch (cmd.type) {
    case 'addStaticTriangleMesh':
      return { ...cmd, vertices: cmd.vertices.slice(), indices: cmd.indices.slice() }
    case 'restoreSnapshot':
      return { ...cmd, bytes: cmd.bytes.slice() }
    case 'addPinField':
      return cmd.desc.occupancy ? { ...cmd, desc: { ...cmd.desc, occupancy: cmd.desc.occupancy.slice() } } : cmd
    default:
      return cmd
  }
}

/** Drop transient commands and keep only the last write of each last-write-wins setter. */
export function compactStructure(commands: readonly Command[]): Command[] {
  const lastIndex = new Map<string, number>()
  commands.forEach((cmd, i) => {
    if (LAST_WRITE_WINS.has(cmd.type)) lastIndex.set(targetKey(cmd), i)
  })
  const out: Command[] = []
  commands.forEach((cmd, i) => {
    if (TRANSIENT.has(cmd.type)) return
    if (LAST_WRITE_WINS.has(cmd.type) && lastIndex.get(targetKey(cmd)) !== i) return
    out.push(cmd)
  })
  return out
}

/** Request id the log's own checkpoint restore carries; no client request ever uses it. */
export const RECOVERY_REQUEST_ID = -1

export class PhysicsCommandLog {
  private prefix: Command[] = []
  private checkpointBytes: Uint8Array | null = null
  private suffix: Command[] = []
  private stepsInSuffix = 0

  /** Record commands as sent (cloned where the send transfers buffers). */
  record(commands: readonly Command[]): void {
    for (const cmd of commands) {
      if (cmd.type === 'step') this.stepsInSuffix++
      this.suffix.push(cloneCommandForLog(cmd))
    }
  }

  /** Steps recorded since the last checkpoint. */
  get stepsSinceCheckpoint(): number {
    return this.stepsInSuffix
  }

  /** Commands held (prefix + suffix), for tests and the debug HUD. */
  get size(): number {
    return this.prefix.length + this.suffix.length
  }

  get hasCheckpoint(): boolean {
    return this.checkpointBytes !== null
  }

  /**
   * Position a checkpoint request is about to take: the index in the suffix of the next
   * recorded command. Pass it back to `checkpoint()` with the blob.
   */
  mark(): number {
    return this.suffix.length
  }

  /**
   * `bytes` is the world as of suffix index `at` (the serialize request recorded there). Folds
   * everything before it into the structural prefix.
   */
  checkpoint(bytes: Uint8Array, at: number): void {
    if (at < 0 || at > this.suffix.length) return
    const before = this.suffix.slice(0, at)
    const after = this.suffix.slice(at)
    this.prefix = compactStructure([...this.prefix, ...before])
    this.checkpointBytes = bytes.slice()
    this.suffix = after
    this.stepsInSuffix = after.reduce((n, cmd) => n + (cmd.type === 'step' ? 1 : 0), 0)
  }

  /** The batch that rebuilds the logged world in a fresh engine. */
  recoveryBatch(): Command[] {
    if (!this.checkpointBytes) return [...this.prefix, ...this.suffix]
    return [
      ...this.prefix,
      { type: 'restoreSnapshot', requestId: RECOVERY_REQUEST_ID, bytes: this.checkpointBytes.slice() },
      ...this.suffix,
    ]
  }

  clear(): void {
    this.prefix = []
    this.checkpointBytes = null
    this.suffix = []
    this.stepsInSuffix = 0
  }
}
