/**
 * The one type Playwright specs use for `window.game`.
 *
 * It is the real `Game` class, not a hand-written probe shape: `src/vite-env.d.ts` already
 * declares `Window.game?: Game` (main.ts assigns it), and tsconfig.tests.json includes that file,
 * so `window.game` inside `page.evaluate(() => …)` is typed against the current source. A hook
 * that moves or is renamed in src/ (`ballManager.trailMaterialPool` → `ballManager.presentation
 * .trailMaterialPool`, `physicsController.handleBallLoss` → `physicsController.scoringBridge
 * .handleBallLoss`) is then a `tsc -b` error instead of a nightly Playwright failure.
 *
 * Only types are imported, so nothing from src/ is bundled into the spec or serialised into the
 * page: `page.evaluate` callbacks run in the browser and must keep reading `window.game` there.
 *
 * Reaching a private member is deliberate and rare: use a public accessor where one exists,
 * otherwise a narrow local cast with a `// reason` comment at the call site.
 */
import type { Game } from '../src/game'

export type GameTestHandle = Game

/** `window` as a spec sees it; the same as the global `Window`, spelled out for readers. */
export type GameTestWindow = Window & { game?: GameTestHandle }

/**
 * A booted Game, for specs that only read it after `game.ready`: the members that are null before
 * boot (or in a mode the spec does not run: scene, effects, ballManager, renderer, …) read as
 * non-null, so a spec does not need a `!` on every hop. Public members only, like any mapped type
 * over a class; nested nullability (a shadow map, a mesh lookup) is still the spec's to handle.
 */
export type BootedGame = { [K in keyof Game]: NonNullable<Game[K]> }

/** `window` for specs that read a booted Game (see BootedGame). */
export type BootedGameWindow = Window & { game?: BootedGame }
