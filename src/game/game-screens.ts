/**
 * The static screens in index.html that the Game shows, hides and writes into (the start screen,
 * the menu / pause overlays, the game-over screen and the score read-outs).
 *
 * They were six public mutable fields on `Game`, each re-declared on every host interface that
 * touched one. A host now takes `screens` (or a `Pick<GameScreens, …>` of it). Resolved once, when
 * the settings UI stage runs; every entry is null where the page has no such element (a test page,
 * an embedder), and each reader already tolerates that.
 */
export interface GameScreens {
  /** `#score`: the live score read-out. */
  readonly score: HTMLElement | null
  readonly menuOverlay: HTMLElement | null
  readonly pauseOverlay: HTMLElement | null
  readonly startScreen: HTMLElement | null
  readonly gameOverScreen: HTMLElement | null
  /** `#final-score`: the number on the game-over screen. */
  readonly finalScore: HTMLElement | null
}

/** Before `init()` has looked: no screens. */
export const NO_SCREENS: GameScreens = {
  score: null,
  menuOverlay: null,
  pauseOverlay: null,
  startScreen: null,
  gameOverScreen: null,
  finalScore: null,
}

export function resolveGameScreens(doc: Pick<Document, 'getElementById'>): GameScreens {
  return {
    score: doc.getElementById('score'),
    menuOverlay: doc.getElementById('menu-overlay'),
    pauseOverlay: doc.getElementById('pause-overlay'),
    startScreen: doc.getElementById('start-screen'),
    gameOverScreen: doc.getElementById('game-over-screen'),
    finalScore: doc.getElementById('final-score'),
  }
}
