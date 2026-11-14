/**
 * The character take's lazy loader: routes a state's `characterLayer` URL to the character plane and
 * imports the layer's chunk on first use (keeps `display-character` off the entry chunk).
 *
 * Split out of `display-core.ts`; `DisplaySystem` owns one and reads `layer` for the per-frame work.
 */

import type { Scene } from '@babylonjs/core/scene'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { DisplayState, type DisplayConfig } from './display-types'
import type { AccessibilityConfig } from '../game-elements/accessibility-config'
import type { DisplayCharacterLayer } from './display-character'
import type { DisplayLcdOverlayLayer } from './display-lcd-overlay'

export interface CharacterTakeDeps {
  scene: Scene
  config: DisplayConfig
  /** Read live: the loaded layer adopts the accessibility at the time the chunk arrives. */
  getAccessibility: () => AccessibilityConfig
  /** The backbox root the layer attaches to, or null before `createBackbox`. */
  getBackboxRoot: () => TransformNode | null
  /** A loaded take suppresses the LCD walk-by; a missing one leaves it running. */
  lcdOverlayLayer: Pick<DisplayLcdOverlayLayer, 'setCharacterTakeActive'>
}

export class CharacterTakeLoader {
  /** Lazily imported on the first non-empty characterLayer. */
  layer: DisplayCharacterLayer | null = null
  private loading = false
  private request: { url: string; state: DisplayState } = { url: '', state: DisplayState.IDLE }
  private disposed = false

  constructor(private readonly deps: CharacterTakeDeps) {}

  /** Route a state's characterLayer to the character plane, loading its chunk on first use. */
  requestTake(url: string, state: DisplayState): void {
    this.request = { url, state }
    if (this.layer) {
      this.layer.setTake(url, state)
      return
    }
    if (!url.trim() || this.loading) return
    this.loading = true
    import('./display-character')
      .then(({ DisplayCharacterLayer }) => {
        if (this.disposed) return
        // A loaded take suppresses the LCD walk-by; a missing one leaves it running.
        const layer = new DisplayCharacterLayer(this.deps.scene, this.deps.config, (active) =>
          this.deps.lcdOverlayLayer.setCharacterTakeActive(active)
        )
        const accessibility = this.deps.getAccessibility()
        layer.setAccessibility(
          accessibility.reducedMotion,
          accessibility.flashFrequencyMax <= 1
        )
        const root = this.deps.getBackboxRoot()
        if (root) layer.createLayer(root, this.deps.config)
        this.layer = layer
        layer.setTake(this.request.url, this.request.state)
      })
      .catch((err: unknown) => {
        // The LCD walk-by stays the fallback.
        console.warn('[Display] Character layer chunk failed to load:', err)
      })
      .finally(() => {
        this.loading = false
      })
  }

  /** The character take URL currently requested and whether it has loaded (tests / e2e). */
  getState(): { url: string; active: boolean } {
    return {
      url: this.layer?.getTakeUrl() ?? this.request.url.trim(),
      active: this.layer?.isTakeActive() ?? false,
    }
  }

  dispose(): void {
    this.disposed = true
    this.layer?.dispose()
    this.layer = null
  }
}
