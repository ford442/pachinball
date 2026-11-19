/**
 * Boot stage: the Settings → Profile controls (#506 slice 1). Lazy, so the
 * file I/O and its machine schema stay out of the entry chunk.
 */

import type { Game } from '../../game'

export function registerProfile(game: Game): void {
  void import('../profile-save-ui').then((m) => {
    if (game.signal.aborted) return
    m.bindProfileSaveUI({
      signal: game.signal,
      showMessage: (msg, ms) => game.showMessage(msg, ms),
    })
  })
}
