/**
 * Freezes Babylon's active-mesh list while the scene is static.
 *
 * Evaluating the active meshes (frustum test, LOD, activation, material-ready checks, render-group
 * dispatch) is the biggest per-frame CPU cost of this ~800-mesh scene. A frozen list skips all of
 * it: the list captured at freeze time is simply drawn again every frame. Measured in a browser
 * (WebGL2 / SwiftShader, MEDIUM, `?noopt=1`): active-mesh evaluation 5.5 -> 0 ms and median render
 * time 16.1 -> 12.1 ms on the menu, 21.3 -> 16.1 ms on the table (docs/RENDER_BUDGET.md).
 *
 * The list is captured with frustum clipping OFF, so it holds every enabled, visible, ready mesh,
 * not just what the camera sees at that instant. The table camera re-aims a hair on nearly every
 * frame while a game is running (CameraController), and balls, flippers and toys move constantly;
 * a list that depended on the frustum would be stale at once. The GPU clips what is off screen.
 * That costs some draws for off-screen meshes, so the freeze is declined when it would add more
 * than `MAX_OFFSCREEN_RATIO` (an adventure track far longer than the view).
 *
 * What a frozen list silently stops honouring, and what catches it here:
 *   - meshes added or removed ........ StaticSceneGate's mesh watchers
 *   - setEnabled / isVisible toggles .. `RenderStateWatcher` (per-frame, below)
 *   - a material swapped on a mesh, or a material or mesh turning translucent (it must move
 *     render groups) .......................... `RenderStateWatcher`
 *   - a particle system starting or stopping, or `scene.particlesEnabled` flipping (the game's
 *     SceneOptimizer does that on a device that misses 55 fps; a frozen list would keep drawing
 *     the particle systems it captured) ......... `RenderStateWatcher`
 *   - the camera being replaced or moving (LOD picks are frozen too; the table camera's
 *     position never moves, only its aim) ...... `RenderStateWatcher`
 * Any change thaws the list through the gate and it refreezes once the signature holds still.
 *
 * Why not `scene.freezeActiveMeshes()`: it waits on `scene.executeWhenReady`, which needs EVERY
 * started particle system and texture to report ready. After Start the effects' ball-trail
 * particle system never does, so in a playing game the call would never take effect. This does
 * what it does, minus that wait, using the same scene internals, and checks the ones it needs
 * exist (a Babylon change that removes them leaves the list thawed rather than throwing).
 */

import type { StaticSceneInvalidation, StaticSceneTarget } from '../core/static-scene-gate'

/** Decline the freeze when the unclipped list is more than this many times the clipped one. */
export const MAX_OFFSCREEN_RATIO = 1.3

export interface ActiveListMesh {
  readonly subMeshes?: readonly unknown[] | null
  readonly visibility: number
  readonly isVisible: boolean
  readonly material?: { readonly uniqueId: number } | null
  isEnabled(checkAncestors?: boolean): boolean
  isReady(completeCheck?: boolean): boolean
}

export interface ActiveListMaterial {
  needAlphaBlending(): boolean
  needAlphaTesting(): boolean
}

export interface ActiveListParticleSystem {
  isStarted(): boolean
  readonly emitter: unknown
}

export interface ActiveListCamera {
  readonly uniqueId: number
  readonly fov?: number
  readonly globalPosition: { readonly x: number; readonly y: number; readonly z: number }
}

/** What `RenderStateWatcher` reads. */
export interface RenderStateScene {
  readonly meshes: readonly ActiveListMesh[]
  readonly materials: readonly ActiveListMaterial[]
  readonly particleSystems: readonly ActiveListParticleSystem[]
  readonly activeCamera: ActiveListCamera | null
  /** Babylon's `Scene.particlesEnabled`; undefined reads as on. */
  readonly particlesEnabled?: boolean
}

/** What the target drives, including the Babylon internals it needs. */
export interface ActiveMeshesScene extends RenderStateScene {
  skipFrustumClipping: boolean
  updateTransformMatrix(force?: boolean): void
  unfreezeActiveMeshes(): unknown
  _evaluateActiveMeshes?: () => void
  _activeMeshes?: { readonly data: Array<{ _freeze?: () => void }>; readonly length: number }
  _activeMeshesFrozen?: boolean
  _activeMeshesFrozenButKeepClipping?: boolean
  _skipEvaluateActiveMeshesCompletely?: boolean
}

/** The camera's position is compared on this grid, so only a real move counts. */
const CAMERA_POSITION_STEP = 0.25

/**
 * Turns "something a frozen active list would ignore changed" into one integer per frame; the gate
 * invalidates whenever it differs from the previous frame's. Cheap and allocation-free (one pass
 * over the meshes, materials and particle systems). Stateless, so the first sample is the baseline.
 */
export class RenderStateWatcher {
  private readonly scene: RenderStateScene

  constructor(scene: RenderStateScene) {
    this.scene = scene
  }

  sample(): number {
    let h = 0x811c9dc5 | 0
    const mix = (value: number): void => {
      h = Math.imul(h ^ (value | 0), 16777619)
    }

    const { meshes, materials, particleSystems, activeCamera, particlesEnabled } = this.scene
    mix(particlesEnabled === false ? 1 : 0)
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i]
      mix(
        (mesh.isEnabled() ? 1 : 0) |
          (mesh.isVisible ? 2 : 0) |
          (mesh.visibility < 1 ? 4 : 0) |
          ((mesh.material ? mesh.material.uniqueId : 0) << 3),
      )
    }
    for (let i = 0; i < materials.length; i++) {
      const material = materials[i]
      mix((material.needAlphaBlending() ? 1 : 0) | (material.needAlphaTesting() ? 2 : 0))
    }
    for (let i = 0; i < particleSystems.length; i++) {
      const system = particleSystems[i]
      if (!system.isStarted() || !system.emitter) {
        mix(0)
        continue
      }
      const emitter = system.emitter as { isEnabled?: () => boolean }
      mix(((i + 1) << 1) | (emitter.isEnabled === undefined || emitter.isEnabled() ? 1 : 0))
    }
    if (activeCamera) {
      const p = activeCamera.globalPosition
      mix(activeCamera.uniqueId)
      mix(Math.round((activeCamera.fov ?? 0) * 100))
      mix(Math.round(p.x / CAMERA_POSITION_STEP))
      mix(Math.round(p.y / CAMERA_POSITION_STEP))
      mix(Math.round(p.z / CAMERA_POSITION_STEP))
    }
    return h
  }
}

/** `?freezeMeshes=0` switches the active-mesh freeze off (a kill switch; it is on by default). */
export function isActiveMeshFreezeEnabled(search: string): boolean {
  return new URLSearchParams(search).get('freezeMeshes') !== '0'
}

export class FrozenActiveMeshes implements StaticSceneTarget {
  readonly name = 'activeMeshes'

  private readonly scene: ActiveMeshesScene
  private frozen = false
  private _declined = false

  constructor(scene: ActiveMeshesScene) {
    this.scene = scene
  }

  get isFrozen(): boolean {
    return this.frozen
  }

  /** True when the last refreeze was declined because too many meshes would be drawn off screen. */
  get declined(): boolean {
    return this._declined
  }

  /** Whether this Babylon build still has the internals the freeze uses. */
  get isSupported(): boolean {
    const scene = this.scene
    return (
      typeof scene._evaluateActiveMeshes === 'function' &&
      scene._activeMeshes !== undefined &&
      typeof scene.updateTransformMatrix === 'function'
    )
  }

  thaw(_invalidation: StaticSceneInvalidation): void {
    this._declined = false
    if (!this.frozen) return
    this.scene.unfreezeActiveMeshes()
    this.frozen = false
  }

  /**
   * Freezing captures whatever is active right now, so a mesh whose shader is still compiling
   * would be left out until the next thaw. Wait until everything that will draw is ready. (This
   * is `isReady(true)` on visible meshes only: asking a hidden one would compile its shaders.)
   */
  canRefreeze(): boolean {
    if (!this.isSupported || !this.scene.activeCamera) return true
    const { meshes } = this.scene
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i]
      if (!mesh.subMeshes || mesh.subMeshes.length === 0) continue
      if (!mesh.isEnabled() || !mesh.isVisible) continue
      if (!mesh.isReady(true)) return false
    }
    return true
  }

  refreeze(): void {
    const scene = this.scene
    if (this.frozen || !this.isSupported || !scene.activeCamera) return
    scene.updateTransformMatrix()
    const active = scene._activeMeshes!

    // What the camera would cull, against what an unclipped list holds.
    scene._evaluateActiveMeshes!()
    const clipped = active.length
    const previous = scene.skipFrustumClipping
    scene.skipFrustumClipping = true
    scene._evaluateActiveMeshes!()
    scene.skipFrustumClipping = previous
    if (active.length > clipped * MAX_OFFSCREEN_RATIO) {
      this._declined = true
      return
    }
    this._declined = false

    scene._activeMeshesFrozen = true
    scene._activeMeshesFrozenButKeepClipping = false
    // Skip even the per-mesh computeWorldMatrix: a mesh that moved is still re-posed lazily by
    // getWorldMatrix() when it is drawn.
    scene._skipEvaluateActiveMeshesCompletely = true
    for (let i = 0; i < active.length; i++) active.data[i]._freeze?.()
    this.frozen = true
  }
}
