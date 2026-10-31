/**
 * The one lazily imported entry for every Frame Graph in the game (#461): the backbox composite
 * (Slice A) and the scene post chain (Slice B).
 *
 * Both consumers `import()` THIS module, not the graph modules. Two dynamic entries that share
 * Babylon's FrameGraph core would otherwise leave a third, shared chunk behind; through one entry
 * Rollup puts everything only the graphs reach into a single chunk, fetched on first use and by
 * nobody at boot. (Modules the boot chunk also needs, such as the plan modules, stay in it.)
 * Import types from the graph modules directly; import values from here, lazily.
 */

export { BackboxFrameGraph } from './display/backbox-frame-graph'
export { SceneFrameGraph } from './game/scene-frame-graph'
