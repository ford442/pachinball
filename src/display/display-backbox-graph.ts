/**
 * Backbox Frame Graph lifecycle (#461): the display layers composed into one texture on one plane.
 *
 * Lazily imported (so its Babylon tasks stay off the entry chunk), built once the layers exist, and
 * rebuilt when the accessibility flags change the node set. Split out of `display-core.ts`;
 * `DisplaySystem` owns one of these and forwards `getBackboxGraphInfo()` / `setStaticSceneGate()`.
 */

import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import type { DisplayConfig } from './display-types'
import type { QualityTier } from '../game-elements/visual-language'
import type { AccessibilityConfig } from '../game-elements/accessibility-config'
import type { DisplayShaderLayer } from './display-shader'
import type { DisplayReelsLayer } from './display-reels'
import type { DisplayPhysicalLayer } from './display-physical'
import type { DisplayVideoLayer } from './display-video'
import type { DisplayImageLayer } from './display-image'
import type { DisplayCharacterLayer } from './display-character'
import type { DisplayLcdOverlayLayer } from './display-lcd-overlay'
import { DISPLAY_LAYER_Z } from './display-layer-depth'
import {
  planBackboxGraph,
  type BackboxGraphFlags,
  type BackboxGraphPlan,
} from './backbox-graph-plan'
import type { BackboxFrameGraph, BackboxGraphInfo, BackboxLayerSource } from './backbox-frame-graph'
import type { StaticSceneGate } from '../core/static-scene-gate'

export type BackboxGraphStatus = 'idle' | 'pending' | 'built' | 'failed'

/** What `getBackboxGraphInfo()` reports: the plan always, the built graph once it exists. */
export interface BackboxGraphReport {
  status: BackboxGraphStatus
  error: string | null
  plan: BackboxGraphPlan
  graph: BackboxGraphInfo | null
}

export interface DisplayBackboxGraphDeps {
  scene: Scene
  config: DisplayConfig
  qualityTier: QualityTier
  /** `?nopp=1`: the graph is the composite and nothing else (no CRT, no jackpot pass). */
  noPostProcess: boolean
  softwareRaster: boolean
  /** Read live: toggling photosensitive mode or reduced motion changes the plan at once. */
  getAccessibility: () => AccessibilityConfig
  /** The layers the graph composes (their meshes are read live, as layers rebuild theirs). */
  layers: {
    physical: Pick<DisplayPhysicalLayer, 'getMeshes'>
    shader: Pick<DisplayShaderLayer, 'getMeshes' | 'setJackpotStill' | 'getEffectPasses'>
    reels: Pick<DisplayReelsLayer, 'getMeshes'>
    video: Pick<DisplayVideoLayer, 'getMeshes'>
    image: Pick<DisplayImageLayer, 'getMeshes'>
    lcd: Pick<DisplayLcdOverlayLayer, 'getMeshes'>
    /** The character layer loads lazily: null until its chunk arrives. */
    getCharacter: () => Pick<DisplayCharacterLayer, 'getMeshes'> | null
  }
}

export class DisplayBackboxGraph {
  private graph: BackboxFrameGraph | null = null
  private status: BackboxGraphStatus = 'idle'
  private error: string | null = null
  private staticSceneGate: Pick<StaticSceneGate, 'invalidate'> | null = null
  private disposed = false

  constructor(private readonly deps: DisplayBackboxGraphDeps) {}

  /** The built graph, or null until it exists (the e2e specs read it as `display.backboxGraph`). */
  getGraph(): BackboxFrameGraph | null {
    return this.graph
  }

  /** Thawed when the backbox graph moves layer meshes off the scene camera's layer mask. */
  setStaticSceneGate(gate: Pick<StaticSceneGate, 'invalidate'> | null): void {
    this.staticSceneGate = gate
  }

  private flags(): BackboxGraphFlags {
    const accessibility = this.deps.getAccessibility()
    return {
      photosensitive: accessibility.photosensitiveMode === true,
      reducedMotion: accessibility.reducedMotion,
      noPostProcess: this.deps.noPostProcess,
      softwareRaster: this.deps.softwareRaster,
    }
  }

  private plan(): BackboxGraphPlan {
    const { config } = this.deps
    return planBackboxGraph(this.flags(), this.deps.qualityTier, config.width / config.height)
  }

  /** The layers' meshes, back to front, as the graph composes them. */
  private layerSources(): BackboxLayerSource[] {
    const { physical, shader, reels, video, image, lcd, getCharacter } = this.deps.layers
    return [
      { id: 'physical', meshes: () => physical.getMeshes() },
      { id: 'grid', meshes: () => shader.getMeshes() },
      { id: 'reels', meshes: () => reels.getMeshes() },
      { id: 'video', meshes: () => video.getMeshes() },
      { id: 'image', meshes: () => image.getMeshes() },
      { id: 'character', meshes: () => getCharacter()?.getMeshes() ?? [] },
      { id: 'lcd', meshes: () => lcd.getMeshes() },
    ]
  }

  /** Build the backbox graph once the layers exist. Until it is ready, nothing is composited. */
  start(root: TransformNode): void {
    const plan = this.plan()
    this.deps.layers.shader.setJackpotStill(plan.effects.includes('jackpotStill'))
    this.status = 'pending'
    this.error = null
    import('../frame-graph-runtime')
      .then(({ BackboxFrameGraph }) => {
        if (this.disposed) return null
        return BackboxFrameGraph.create(
          {
            scene: this.deps.scene,
            root,
            displayWidth: this.deps.config.width,
            displayHeight: this.deps.config.height,
            planeZ: DISPLAY_LAYER_Z.COMPOSITE,
            layers: this.layerSources(),
            effects: this.deps.layers.shader.getEffectPasses(),
            onLayerMasksChanged: () => this.staticSceneGate?.invalidate('backbox-graph'),
          },
          plan
        )
      })
      .then((graph) => {
        if (!graph) return
        if (this.disposed) {
          graph.dispose()
          return
        }
        this.graph = graph
        this.status = 'built'
        console.log(`[Display] Backbox graph built: ${graph.getInfo().nodes.join(' → ')}`)
        // Accessibility may have changed while the graph was compiling.
        this.syncPlan()
      })
      .catch((err: unknown) => {
        // The graph handed the layer meshes back to the scene camera when it failed.
        this.status = 'failed'
        this.error = err instanceof Error ? err.message : String(err)
        console.warn('[Display] Backbox graph failed to build:', err)
      })
  }

  /** Rebuild the graph when the node set changes (photosensitive / reduced motion toggled). */
  syncPlan(): void {
    const plan = this.plan()
    this.deps.layers.shader.setJackpotStill(plan.effects.includes('jackpotStill'))
    const graph = this.graph
    if (!graph) return
    graph.rebuild(plan).then(() => {
      if (this.graph !== graph) return
      this.status = 'built'
      this.error = null
    }).catch((err: unknown) => {
      this.status = 'failed'
      this.error = err instanceof Error ? err.message : String(err)
      console.warn('[Display] Backbox graph rebuild failed:', err)
    })
  }

  /** The backbox graph's plan and, once built, its node list (debug HUD, e2e). */
  getInfo(): BackboxGraphReport {
    return {
      status: this.status,
      error: this.error,
      plan: this.plan(),
      graph: this.graph?.getInfo() ?? null,
    }
  }

  dispose(): void {
    this.graph?.dispose()
    this.graph = null
    this.disposed = true
  }
}
