/**
 * The two arcade overlays — leaderboard and name entry — as one lazily loaded service.
 *
 * They used to live as three private fields, a getter pair and a loader on `GameFields`; every
 * host that needed a leaderboard had to be a `Game`. Now a host takes `overlays` (this class, or a
 * `Pick<ArcadeOverlays, …>` of it): the first slice of moving services off `Game` onto small
 * context objects (docs: CLAUDE.md, "Lifecycle conventions").
 *
 * Both chunks are fetched on first use, off the boot path. `ensure()` can be pending when the Game
 * is disposed: the continuation then creates nothing (its module singletons' resets would land on
 * a list that was already drained and leak into the next Game).
 */
import type { LeaderboardSystem } from '../game-elements/leaderboard-system'
import type { NameEntryDialog } from '../game-elements/name-entry-dialog'

export interface ArcadeOverlaysOptions {
  /** Aborted by `Game.dispose()`. */
  readonly signal: AbortSignal
  /** A leaderboard row's "watch" button: play that run back. */
  readonly onSpectate: (replayId: string) => void
}

export class ArcadeOverlays {
  private leaderboardSystem: LeaderboardSystem | null = null
  private nameEntryDialog: NameEntryDialog | null = null
  private ready: Promise<void> | null = null
  /** Resets for the module singletons created by `ensure()`. */
  private resets: Array<() => void> = []

  constructor(private readonly options: ArcadeOverlaysOptions) {}

  /** Load both overlays (once); resolves immediately when they are already there. */
  async ensure(): Promise<void> {
    if (this.leaderboardSystem && this.nameEntryDialog) return
    if (!this.ready) {
      this.ready = Promise.all([
        import('../game-elements/leaderboard-system'),
        import('../game-elements/name-entry-dialog'),
      ])
        .then(([lb, ne]) => {
          if (this.options.signal.aborted) return
          const leaderboard = lb.getLeaderboardSystem()
          this.leaderboardSystem = leaderboard
          this.nameEntryDialog = ne.getNameEntryDialog()
          this.resets.push(lb.resetLeaderboardSystem, ne.resetNameEntryDialog)
          leaderboard.setOnSpectateCallback((replayId) => this.options.onSpectate(replayId))
        })
        .catch((err: unknown) => {
          this.ready = null
          throw err
        })
    }
    await this.ready
  }

  get leaderboard(): LeaderboardSystem {
    if (!this.leaderboardSystem) {
      throw new Error('LeaderboardSystem not loaded — call overlays.ensure() first')
    }
    return this.leaderboardSystem
  }

  get nameEntry(): NameEntryDialog {
    if (!this.nameEntryDialog) {
      throw new Error('NameEntryDialog not loaded — call overlays.ensure() first')
    }
    return this.nameEntryDialog
  }

  /** Stop the leaderboard, reset the singletons this created, and forget them. */
  dispose(): void {
    this.leaderboardSystem?.stop()
    for (const reset of this.resets) reset()
    this.resets = []
    this.leaderboardSystem = null
    this.nameEntryDialog = null
    this.ready = null
  }
}
