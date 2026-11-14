/**
 * Fail-closed boundary of the headless replay runner (#528).
 *
 * The Node runner replays what it can replay exactly: the table, flippers and plunger, contact
 * dispatch, scoring, combos, drains and respawns, the feeders' idle checks. Some gameplay still
 * lives in presentation-owned classes (toy and feeder state machines, the backbox slot machine, the
 * jackpot sequence); a tape that reaches one is not replayed with a stand-in. The guard records the
 * first such reach and the run reports `unsupported`, so a caller falls back to the Chromium
 * harness instead of trusting a number Node could not reproduce.
 */

export class NodeReplayUnsupported extends Error {
  constructor(readonly reason: string) {
    super(`not replayable in Node: ${reason}`)
    this.name = 'NodeReplayUnsupported'
  }
}

export class HeadlessGuard {
  /** The first unsupported reach, or null. */
  reason: string | null = null

  /** Record `reason` (the first one wins) and throw, so the step stops where it is. */
  fail(reason: string): never {
    this.reason ??= reason
    throw new NodeReplayUnsupported(reason)
  }
}
