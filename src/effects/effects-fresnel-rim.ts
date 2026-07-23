import { Color3, PBRMaterial } from '@babylonjs/core'
import type { AbstractMesh } from '@babylonjs/core'
import { BallType } from '../config'
import type { BallManager } from '../game-elements/ball-manager'
import type { EventBus } from '../game/event-bus'
import { INTENSITY, QualityTier, STATE_COLORS } from '../game-elements/visual-language'
import { FresnelRimMaterialPlugin, FRESNEL_RIM_PHASE_FREQ } from './fresnel-rim-plugin'

/** Per-mesh rim tracking handle. */
export interface RimHandle {
  plugin: FresnelRimMaterialPlugin
  phase: number
  peakIntensity: number
}

export class FresnelRimController {
  private qualityTier: QualityTier
  private activeRims = new Map<AbstractMesh, RimHandle>()
  private rimEventUnsubscribers: Array<() => void> = []
  private ballMeshProvider: Pick<BallManager, 'getBallMeshesByType'> | null = null
  // Pre-allocated Color3 for FEVER rim colour (avoid per-call allocation)
  private readonly feverRimColor: Color3 = Color3.FromHexString(STATE_COLORS.FEVER)

  constructor(qualityTier: QualityTier) {
    this.qualityTier = qualityTier
  }

  setQualityTier(tier: QualityTier): void {
    this.qualityTier = tier
  }

  /**
   * Wire the event bus so EffectsSystem can subscribe to fever:start / fever:end.
   * Call once after both EffectsSystem and BallManager are ready.
   */
  setEventBus(eventBus: EventBus): void {
    // Unsubscribe any previous listeners (idempotent re-wiring)
    for (const unsub of this.rimEventUnsubscribers) unsub()
    this.rimEventUnsubscribers = []

    this.rimEventUnsubscribers.push(
      eventBus.on('fever:start', () => {
        if (!this.ballMeshProvider) return
        for (const ballType of [BallType.GOLD_PLATED, BallType.SOLID_GOLD]) {
          const meshes = this.ballMeshProvider.getBallMeshesByType(ballType)
          for (const mesh of meshes) {
            this.setFresnelRimEffect(mesh, this.feverRimColor, INTENSITY.FLASH)
          }
        }
      }),
      eventBus.on('fever:end', () => {
        if (!this.ballMeshProvider) return
        for (const ballType of [BallType.GOLD_PLATED, BallType.SOLID_GOLD]) {
          const meshes = this.ballMeshProvider.getBallMeshesByType(ballType)
          for (const mesh of meshes) {
            this.clearFresnelRimEffect(mesh)
          }
        }
      })
    )
  }

  /**
   * Wire the ball-mesh provider so EffectsSystem can look up gold ball meshes.
   * Call once after BallManager is ready.
   */
  setBallMeshProvider(provider: Pick<BallManager, 'getBallMeshesByType'>): void {
    this.ballMeshProvider = provider
  }

  /**
   * Attach a pulsing fresnel rim to `mesh`'s PBRMaterial.
   * - No-op on LOW quality tier.
   * - No-op if the material is not PBRMaterial.
   * - Idempotent: updating color/intensity on an already-tracked mesh does NOT
   *   reset the pulse phase (prevents "pop" on double fever:start).
   * - Registers an onDisposeObservable listener so a mesh collected mid-FEVER
   *   cannot leak a stale RimHandle.
   */
  setFresnelRimEffect(mesh: AbstractMesh, rimColor: Color3, peakIntensity: number): void {
    if (this.qualityTier === QualityTier.LOW) return
    if (!(mesh.material instanceof PBRMaterial)) return

    const mat = mesh.material
    const existing = this.activeRims.get(mesh)
    if (existing) {
      // Update color and intensity without resetting phase (no pop on re-enter)
      existing.plugin.rimColor.r = rimColor.r
      existing.plugin.rimColor.g = rimColor.g
      existing.plugin.rimColor.b = rimColor.b
      existing.peakIntensity = peakIntensity
      return
    }

    // Reuse an existing plugin on the material (shared-material case — all gold
    // balls share one PBRMaterial instance, so the plugin already exists after
    // the first ball is processed).
    let plugin = mat.pluginManager?.getPlugin<FresnelRimMaterialPlugin>('FresnelRim') ?? null
    if (!plugin) {
      plugin = new FresnelRimMaterialPlugin(mat)
    }
    plugin.rimColor.r = rimColor.r
    plugin.rimColor.g = rimColor.g
    plugin.rimColor.b = rimColor.b
    plugin.isEnabled = true

    const handle: RimHandle = { plugin, phase: 0, peakIntensity }
    this.activeRims.set(mesh, handle)

    // Auto-cleanup if the mesh is disposed mid-FEVER
    mesh.onDisposeObservable.addOnce(() => this.clearFresnelRimEffect(mesh))
  }

  /**
   * Disable and remove the fresnel rim for `mesh`.
   * Only disables the underlying plugin when no other tracked mesh shares it
   * (reference-count guard for shared-material gold balls).
   */
  clearFresnelRimEffect(mesh: AbstractMesh): void {
    const handle = this.activeRims.get(mesh)
    if (!handle) return

    this.activeRims.delete(mesh)

    // Disable the plugin only if no remaining handle still uses it
    let stillUsed = false
    for (const h of this.activeRims.values()) {
      if (h.plugin === handle.plugin) {
        stillUsed = true
        break
      }
    }
    if (!stillUsed) {
      handle.plugin.rimIntensity = 0
      handle.plugin.isEnabled = false
    }
  }

  update(dt: number): void {
    // Advance fresnel rim pulses (no allocations: forEach + direct uniform writes)
    if (this.activeRims.size === 0) return

    this.activeRims.forEach((handle) => {
      handle.phase += dt * FRESNEL_RIM_PHASE_FREQ
      handle.plugin.rimIntensity = ((Math.sin(handle.phase) + 1) * 0.5) * handle.peakIntensity
    })
  }

  dispose(): void {
    for (const unsub of this.rimEventUnsubscribers) unsub()
    this.rimEventUnsubscribers = []

    this.activeRims.forEach((handle) => {
      handle.plugin.rimIntensity = 0
      handle.plugin.isEnabled = false
    })
    this.activeRims.clear()
  }
}
