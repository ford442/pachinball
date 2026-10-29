/**
 * What the rest of the game sees of the scene post-process graph (#461 Slice B).
 *
 * `EffectsSystem`, `PostProcessManager` and the runtime performance tiers all write post-process
 * knobs (`bloomWeight`, `imageProcessing.vignetteWeight`, ...) through `BloomPipelineController`,
 * as they did with `DefaultRenderingPipeline`. This is that surface, kept as plain retained state:
 *
 *   - it exists from the first line of `setup()`, before the Frame Graph chunk has even loaded, so
 *     nothing has to wait for or null-check the graph;
 *   - the graph (`scene-frame-graph.ts`, lazy) reads it once per frame and applies only what
 *     changed to its nodes;
 *   - a knob that is part of a built node (the bloom scale) asks the owner for a rebuild instead.
 *
 * No Babylon runtime code except `Color4`, which the boot chunk already has.
 */

import { Color4 } from '@babylonjs/core/Maths/math.color'
import type { BloomImageProcessingSurface, BloomPipelineController } from '../effects/bloom-pipeline-types'

/**
 * The image-processing node's knobs. `version` moves whenever a value does, so the graph can skip a
 * frame cheaply.
 *
 * The defaults are `ImageProcessingConfiguration`'s own (no tone mapping, contrast and exposure 1,
 * vignette off at weight 1.5): the look the game has always shipped. `DefaultRenderingPipeline`'s
 * setup meant to apply an ACES grade, but ran it before the pipeline had built its image-processing
 * stage, so none of it ever took effect (docs/FRAME_GRAPH.md, "The cabinet grade").
 */
export class ScenePostImageProcessing implements BloomImageProcessingSurface {
  /** Bumped on every effective change. */
  version = 0
  /** False under reduced motion: the vignette stays off, flashes included. */
  vignetteAllowed = true

  private _vignetteWeight = 1.5
  private _vignetteColor = new Color4(0, 0, 0, 0)
  private _vignetteBlendMode = 0
  private _vignetteEnabled = false
  private _colorCurvesEnabled = false
  private _colorGradingEnabled = false
  private _toneMappingEnabled = false
  private _toneMappingType = 0
  private _contrast = 1
  private _exposure = 1

  get vignetteWeight(): number { return this._vignetteWeight }
  set vignetteWeight(value: number) { if (value !== this._vignetteWeight) { this._vignetteWeight = value; this.version++ } }

  get vignetteColor(): Color4 { return this._vignetteColor }
  set vignetteColor(value: Color4) { this._vignetteColor = value; this.version++ }

  get vignetteBlendMode(): number { return this._vignetteBlendMode }
  set vignetteBlendMode(value: number) { if (value !== this._vignetteBlendMode) { this._vignetteBlendMode = value; this.version++ } }

  get vignetteEnabled(): boolean { return this._vignetteEnabled && this.vignetteAllowed }
  set vignetteEnabled(value: boolean) { if (value !== this._vignetteEnabled) { this._vignetteEnabled = value; this.version++ } }

  get colorCurvesEnabled(): boolean { return this._colorCurvesEnabled }
  set colorCurvesEnabled(value: boolean) { if (value !== this._colorCurvesEnabled) { this._colorCurvesEnabled = value; this.version++ } }

  get colorGradingEnabled(): boolean { return this._colorGradingEnabled }
  set colorGradingEnabled(value: boolean) { if (value !== this._colorGradingEnabled) { this._colorGradingEnabled = value; this.version++ } }

  get toneMappingEnabled(): boolean { return this._toneMappingEnabled }
  set toneMappingEnabled(value: boolean) { if (value !== this._toneMappingEnabled) { this._toneMappingEnabled = value; this.version++ } }

  get toneMappingType(): number { return this._toneMappingType }
  set toneMappingType(value: number) { if (value !== this._toneMappingType) { this._toneMappingType = value; this.version++ } }

  get contrast(): number { return this._contrast }
  set contrast(value: number) { if (value !== this._contrast) { this._contrast = value; this.version++ } }

  get exposure(): number { return this._exposure }
  set exposure(value: number) { if (value !== this._exposure) { this._exposure = value; this.version++ } }

  /** Plan changed whether the vignette may show. */
  setVignetteAllowed(allowed: boolean): void {
    if (allowed === this.vignetteAllowed) return
    this.vignetteAllowed = allowed
    this.version++
  }
}

/** The graph, as the controller sees it. */
export interface ScenePostOwner {
  /** A knob that is part of a built node changed (the bloom scale): build the graph again. */
  requestRebuild(): void
  dispose(): void
}

export class ScenePostController implements BloomPipelineController {
  bloomWeight = 0.25
  bloomKernel = 64
  bloomThreshold = 0.75
  /** Per-frame pass-through, not a node-set change: a disabled bloom node copies its input. */
  bloomEnabled = true
  sharpenEnabled = true

  private _bloomScale = 0.5
  private readonly _imageProcessing = new ScenePostImageProcessing()
  private hasImageProcessing = false
  private owner: ScenePostOwner | null = null

  get bloomScale(): number {
    return this._bloomScale
  }

  set bloomScale(value: number) {
    if (value === this._bloomScale) return
    this._bloomScale = value
    this.owner?.requestRebuild()
  }

  /** The knobs of the image-processing node; null when the plan left that node out (strict adapter, bloom-only). */
  get imageProcessing(): ScenePostImageProcessing | null {
    return this.hasImageProcessing ? this._imageProcessing : null
  }

  /** The graph reads this directly: it exists whether or not the node does. */
  get imageProcessingState(): ScenePostImageProcessing {
    return this._imageProcessing
  }

  /** Called by the manager with each new plan. */
  setImageProcessingPresent(present: boolean, vignetteAllowed: boolean): void {
    this.hasImageProcessing = present
    this._imageProcessing.setVignetteAllowed(vignetteAllowed)
  }

  attach(owner: ScenePostOwner | null): void {
    this.owner = owner
  }

  /** Effects used to call this after changing a toggle; the graph rebuilds from its plan instead. */
  prepare(): void {
    // Nothing to compile here: the graph's nodes compile when it is built.
  }

  dispose(): void {
    const owner = this.owner
    this.owner = null
    owner?.dispose()
  }
}
