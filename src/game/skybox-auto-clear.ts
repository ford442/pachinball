/**
 * `scene.autoClear = false` while the full-cover skybox is what fills the frame.
 *
 * The skybox is a large unlit box around the cabinet; while the camera is inside it, every pixel
 * is overwritten by the skybox, so clearing the colour buffer first is wasted bandwidth. It is
 * only valid while ALL of that holds, so the flag is re-derived every frame and restored the
 * moment any part stops being true:
 *   - the skybox mesh is enabled and visible (an adventure track may hide it);
 *   - the camera is comfortably inside it and its far plane reaches the box (a follow camera
 *     that leaves the box would smear previous frames across the uncovered area);
 *   - the device is not a phone or tablet: tile-based mobile GPUs get slower, not faster, when a
 *     clear is skipped (the tile has to be loaded from memory instead).
 *
 * Depth and stencil are still cleared (`autoClearDepthAndStencil` is untouched).
 */

export interface AutoClearInputs {
  skyboxEnabled: boolean
  skyboxVisible: boolean
  cameraInsideSkybox: boolean
  mobile: boolean
}

export function shouldSkipColorClear(input: AutoClearInputs): boolean {
  return input.skyboxEnabled && input.skyboxVisible && input.cameraInsideSkybox && !input.mobile
}

/** Fraction of the skybox half-extent the camera must stay within, so an edge case never reaches the faces. */
export const SKYBOX_INSIDE_MARGIN = 0.9

export interface SkyboxLike {
  readonly isVisible: boolean
  isEnabled(): boolean
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
}

export interface AutoClearCamera {
  readonly globalPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly maxZ: number
}

export interface AutoClearScene {
  autoClear: boolean
  readonly activeCamera: AutoClearCamera | null
  readonly onBeforeRenderObservable: {
    add(callback: () => void): unknown
    remove(observer: unknown): unknown
  }
}

/** Inside the box with margin, and the far plane reaches its farthest corner. */
export function isCameraInsideSkybox(camera: AutoClearCamera, skybox: SkyboxLike, size: number): boolean {
  const limit = (size / 2) * SKYBOX_INSIDE_MARGIN
  const p = camera.globalPosition
  const c = skybox.position
  const inside = Math.abs(p.x - c.x) < limit && Math.abs(p.y - c.y) < limit && Math.abs(p.z - c.z) < limit
  const farthestCorner = (size / 2) * Math.sqrt(3) + Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z)
  return inside && camera.maxZ >= farthestCorner
}

export class SkyboxAutoClear {
  private readonly scene: AutoClearScene
  private readonly skybox: SkyboxLike
  private readonly size: number
  private readonly mobile: boolean
  private observer: unknown

  constructor(scene: AutoClearScene, skybox: SkyboxLike, size: number, mobile: boolean) {
    this.scene = scene
    this.skybox = skybox
    this.size = size
    this.mobile = mobile
    this.observer = scene.onBeforeRenderObservable.add(() => this.update())
  }

  private update(): void {
    const camera = this.scene.activeCamera
    const skip = shouldSkipColorClear({
      skyboxEnabled: this.skybox.isEnabled(),
      skyboxVisible: this.skybox.isVisible,
      cameraInsideSkybox: camera !== null && isCameraInsideSkybox(camera, this.skybox, this.size),
      mobile: this.mobile,
    })
    if (this.scene.autoClear === skip) this.scene.autoClear = !skip
  }

  dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer)
    this.scene.autoClear = true
  }
}
