/**
 * The WASM bridge the controller steps against: the mirror (Rapier owns the world, C++ follows) or
 * the owner (C++ owns it), chosen by the physics mode and rebuilt whenever the world changes.
 *
 * Split out of `physics-controller.ts`. `GamePhysicsController.rebuildHandleCaches()` calls
 * `rebuild()` here first, then rebuilds the collision dispatcher's handle caches on the ids it assigned.
 */

import type { PhysicsHost } from './types'
import { WasmMirror } from './wasm-mirror'
import { WasmOwner, type AdventureTrackState } from './wasm-owner'
/** Shared surface for mirror and owner WASM bridges. */
import type { WasmContactBridge } from './collision-dispatch'

export class WasmBridges {
  /** WASM bridge for mirror or owner mode. */
  bridge: WasmContactBridge | null = null
  mirror: WasmMirror | null = null
  owner: WasmOwner | null = null

  constructor(private readonly host: PhysicsHost) {}

  /**
   * The C++ flipper hinges the owner drives, or null when physics does not run an owner mode.
   * In an owner mode these hinges are the only thing that moves a flipper (there is no Rapier
   * joint motor to fall back on), and they exist only once `rebuild()` has run.
   */
  getFlipperHingeCount(): number | null {
    if (!(this.host.physics.isWasmOwnerMode?.() ?? false)) return null
    return this.owner?.getFlipperHinges().length ?? 0
  }

  /**
   * Whether WASM owns the active adventure track, and what stopped it if not.
   * Exposed for the E2E cutover check and the debug HUD.
   */
  getAdventureOwnership(): {
    owned: boolean
    unsupported: ReadonlyArray<{ reason: string; index?: number; label?: string }>
  } {
    return {
      owned: this.owner?.isAdventureOwned() ?? false,
      unsupported: this.owner?.getAdventureUnsupported() ?? [],
    }
  }

  /**
   * Table colliders the C++ world is not simulating, each with a reason
   * (shape it cannot represent, or outside the owner table scope). Empty off
   * the owner path. Exposed for the debug HUD.
   */
  getTableUnexported(): ReadonlyArray<{ bodyHandle: number; colliderIndex: number; shape: string; reason: string }> {
    return this.owner?.getTableUnsupported() ?? []
  }

  /** Snapshot of the built adventure track for the C++ exporter, or null when adventure is not running. */
  adventureTrackState(adventureActive: boolean): AdventureTrackState | null {
    const adventure = this.host.adventureMode
    if (!adventureActive || !adventure) return null
    return {
      epoch: adventure.getColliderEpoch(),
      descriptors: adventure.getColliderDescriptors(),
      unexported: adventure.getUnexportedColliders(),
      bodyForDescriptor: (index) => adventure.getBodyForDescriptor(index),
    }
  }

  /** Re-pick the bridge for the current physics mode and rebuild it against the live world. */
  rebuild(): void {
    const wasmActive = this.host.physics.isWasmActive?.() ?? false
    const isOwner = this.host.physics.isWasmOwnerMode?.() ?? false

    if (wasmActive) {
      const engine = this.host.physics.getWasmEngine?.()
      if (engine) {
        engine.init(this.host.eventBus)
        if (isOwner) {
          this.mirror?.clear()
          this.mirror = null
          // PhysicsSystem builds the table world whenever it runs an owner mode.
          const tableWorld = this.host.physics.getWasmTableWorld?.() ?? null
          if (!this.owner && tableWorld) {
            this.owner = new WasmOwner(engine, tableWorld)
            this.owner.setTableScope(() => [
              ...(this.host.gameObjects?.getWasmExportBodies() ?? []),
              // Ball traps (#420): the funnel is a C++ cone and the chamber a
              // sensor sphere; the trap sits well clear of the plunger lane.
              ...(this.host.ballTrapBuilder?.getBodies() ?? []),
              // MagSpin's well (#420 leftover): a C++ axis-pull field, not geometry.
              ...(this.host.magSpinFeeder?.getBodies() ?? []),
              // Zone volumes (scenario zones, obstacle footprints): C++ sensor volumes
              // that report ball begin/end contacts to ZoneTriggerSystem.
              ...(this.host.zoneTriggerSystem?.getSensorBodies() ?? []),
            ])
          }
          this.bridge = this.owner
          if (this.owner) {
            const adventureActive = this.host.adventureMode?.isActive() ?? false
            this.owner.rebuild(
              [...(this.host.gameObjects?.getAllFlippers?.().values() ?? [])].map((f) => f.body),
              this.adventureTrackState(adventureActive),
            )
            this.attachAdventureBridge()
            this.host.physics.setWasmDebugColliders?.(this.owner.getDebugColliders())
          }
        } else {
          this.owner?.dispose()
          this.owner = null
          this.host.physics.setWasmDebugColliders?.([])
          if (!this.mirror) {
            this.mirror = new WasmMirror(engine)
          }
          this.bridge = this.mirror
          this.mirror.rebuild(
            this.host.ballManager?.getBallBodies() || [],
            this.host.gameObjects?.getBumperBodies() || [],
            this.host.gameObjects?.getBumperVisuals() || []
          )
        }
      }
    } else {
      this.mirror?.clear()
      this.owner?.dispose()
      this.mirror = null
      this.owner = null
      this.bridge = null
      this.host.physics.setWasmDebugColliders?.([])
    }
  }

  /**
   * Install the WASM-backed overlap/impulse bridge on a running adventure
   * track so zone effects read C++ sensor contacts. Without it AdventureMode
   * answers overlaps analytically through `world.intersectionPair`.
   *
   * Called from `rebuild`, which already runs on adventure start,
   * end and track switch — exactly the moments the static world changes.
   */
  private attachAdventureBridge(): void {
    const adventureMode = this.host.adventureMode
    const owner = this.owner
    if (!owner || !adventureMode) return
    adventureMode.setPhysicsBridge(adventureMode.isActive() && owner.isAdventureOwned() ? owner.getPhysicsBridge() : null)
  }
}
