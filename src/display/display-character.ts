/**
 * Display Character Layer
 *
 * The Nexus character pack (`StateMediaConfig.characterLayer`) as its own
 * plane between the main video / image and the LCD overlay, so a take
 * composites over the reels and the attract video instead of replacing them
 * (docs/FRAME_GRAPH.md stack). A `.png/.jpg/.webp` URL is a poster; a
 * `.webm/.mp4` URL is a looped take.
 *
 * Until a take has actually loaded the plane stays hidden and `onActiveChange`
 * reports `false`, so a missing file keeps the LCD walk-by.
 *
 * Accessibility:
 *  - photosensitive (flashFrequencyMax <= 1): the REACH / JACKPOT pulse holds a
 *    steady alpha, the same damping the LCD overlay applies to its banners.
 *  - reduced motion: no slide-in walk-on, and a video take is held on its first
 *    frame (a still).
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { VideoTexture } from '@babylonjs/core/Materials/Textures/videoTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'
import { createTimerScope, type TimerScope } from '../core/timers'
import { DisplayState, type DisplayConfig } from './display-types'
import { DISPLAY_LAYER_Z } from './display-layer-depth'

export type CharacterTakeKind = 'video' | 'image'

/** Classify a characterLayer URL by extension; `null` for empty / unknown. */
export function classifyCharacterTake(url: string): CharacterTakeKind | null {
  if (/\.(webm|mp4)(\?|$)/i.test(url)) return 'video'
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(url)) return 'image'
  return null
}

/** Walk-on slide duration in seconds. */
export const CHARACTER_WALK_ON_S = 0.6
/** Resting alpha of a loaded take. */
const BASE_ALPHA = 0.95
const VIDEO_TIMEOUT_MS = 5000

export class DisplayCharacterLayer {
  private readonly scene: Scene
  private readonly onActiveChange: (active: boolean) => void
  private readonly timers: TimerScope = createTimerScope()

  private mesh: Mesh | null = null
  private material: StandardMaterial | null = null
  private texture: Texture | null = null
  private videoElement: HTMLVideoElement | null = null

  private url = ''
  private active = false
  /** Bumped on every setTake / dispose; stale load callbacks compare against it. */
  private token = 0

  private reducedMotion = false
  private photosensitive = false
  private state: DisplayState = DisplayState.IDLE
  private time = 0
  /** 0 → 1 walk-on progress. */
  private walkOn = 1
  private restX = 0
  private offstageX = 0

  constructor(scene: Scene, _config: DisplayConfig, onActiveChange: (active: boolean) => void) {
    this.scene = scene
    this.onActiveChange = onActiveChange
  }

  createLayer(parent: TransformNode, config: DisplayConfig): void {
    const width = config.width ?? 20
    const height = config.height ?? 12
    // A third of the screen on one side: the reels / attract video stay readable.
    this.mesh = MeshBuilder.CreatePlane(
      'displayCharacter',
      { width: width * 0.34, height: height * 0.86 },
      this.scene,
    )
    this.mesh.parent = parent
    this.mesh.rotation.y = Math.PI
    this.restX = width * 0.31
    this.offstageX = width * 0.7
    this.mesh.position.x = this.restX
    this.mesh.position.y = -height * 0.05
    this.mesh.position.z = DISPLAY_LAYER_Z.CHARACTER
    this.mesh.isPickable = false
    this.mesh.isVisible = false
    // A take requested before the backbox existed loads now.
    const pending = this.url
    if (pending) {
      this.url = ''
      this.setTake(pending, this.state)
    }
  }

  setAccessibility(reducedMotion: boolean, photosensitive: boolean): void {
    this.reducedMotion = reducedMotion
    this.photosensitive = photosensitive
    if (reducedMotion) {
      this.walkOn = 1
      this.videoElement?.pause?.()
    }
    this.applyPose()
  }

  /**
   * Show `url` for `state`. Re-requesting the URL already on screen only
   * updates the state (the pulse) — it does not reload or replay the walk-on.
   */
  setTake(url: string, state: DisplayState): void {
    this.state = state
    const next = url.trim()
    if (next === this.url) {
      this.applyPose()
      return
    }

    this.releaseTake()
    this.url = next
    const kind = classifyCharacterTake(next)
    if (!kind || !this.mesh) return

    const token = ++this.token
    if (kind === 'image') {
      this.loadImage(next, token)
    } else {
      this.loadVideo(next, token)
    }
  }

  update(dt: number): void {
    this.time += dt
    if (!this.active) return
    if (this.walkOn < 1) {
      this.walkOn = this.reducedMotion ? 1 : Math.min(1, this.walkOn + dt / CHARACTER_WALK_ON_S)
    }
    this.applyPose()
  }

  isTakeActive(): boolean {
    return this.active
  }

  getTakeUrl(): string {
    return this.url
  }

  /** Current plane alpha (tests / debug). */
  getAlpha(): number {
    return this.material?.alpha ?? 0
  }

  /** The layer's meshes, for its task in the backbox Frame Graph. */
  getMeshes(): Mesh[] {
    return this.mesh ? [this.mesh] : []
  }

  dispose(): void {
    this.timers.dispose()
    this.releaseTake()
    this.url = ''
    try {
      this.mesh?.dispose()
    } catch (err) {
      console.warn('[DisplayCharacter] Error during cleanup:', err)
    } finally {
      this.mesh = null
    }
  }

  private loadImage(url: string, token: number): void {
    const texture = new Texture(
      url,
      this.scene,
      true,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        if (token === this.token) this.becomeActive()
      },
      () => {
        if (token !== this.token) return
        console.warn('[DisplayCharacter] Failed to load:', url)
        this.releaseTake()
      },
    )
    texture.hasAlpha = true
    this.texture = texture
    this.attachMaterial(texture)
  }

  private loadVideo(url: string, token: number): void {
    try {
      const video = document.createElement('video')
      video.src = url
      video.loop = true
      video.muted = true
      video.playsInline = true
      video.crossOrigin = 'anonymous'
      video.preload = 'auto'
      video.style.display = 'none'
      document.body.appendChild(video)
      this.videoElement = video

      video.onloadeddata = () => {
        if (token !== this.token) return
        const texture = new VideoTexture(
          'displayCharacterVideo',
          video,
          this.scene,
          true,
          true,
          Texture.TRILINEAR_SAMPLINGMODE,
          { autoPlay: false, autoUpdateTexture: true },
        )
        this.texture = texture
        this.attachMaterial(texture)
        if (!this.reducedMotion) {
          video.play().catch(() => {
            console.warn('[DisplayCharacter] Autoplay blocked')
          })
        }
        this.becomeActive()
      }
      video.onerror = () => {
        if (token !== this.token) return
        console.warn('[DisplayCharacter] Failed to load:', url)
        this.releaseTake()
      }
      this.timers.setTimeout(() => {
        if (token === this.token && !this.active) {
          console.warn('[DisplayCharacter] Load timeout:', url)
          this.releaseTake()
        }
      }, VIDEO_TIMEOUT_MS)
    } catch (err) {
      console.warn('[DisplayCharacter] Error creating video:', err)
      this.releaseTake()
    }
  }

  private attachMaterial(texture: Texture): void {
    const mat = new StandardMaterial('displayCharacterMat', this.scene)
    mat.diffuseTexture = texture
    mat.useAlphaFromDiffuseTexture = true
    mat.emissiveColor = Color3.White()
    mat.disableLighting = true
    mat.backFaceCulling = false
    mat.alpha = 0
    this.material = mat
    if (this.mesh) this.mesh.material = mat
  }

  private becomeActive(): void {
    this.active = true
    this.walkOn = this.reducedMotion ? 1 : 0
    if (this.mesh) this.mesh.isVisible = true
    this.applyPose()
    this.onActiveChange(true)
  }

  /** Pulse factor for the current state; constant when photosensitive. */
  private statePulse(): number {
    if (this.photosensitive) return 1
    if (this.state === DisplayState.REACH) return 0.85 + Math.sin(this.time * 8) * 0.15
    if (this.state === DisplayState.JACKPOT) return 0.8 + Math.sin(this.time * 12) * 0.2
    return 1
  }

  private applyPose(): void {
    if (!this.mesh || !this.material || !this.active) return
    const t = this.walkOn
    const eased = 1 - (1 - t) * (1 - t) * (1 - t)
    this.mesh.position.x = this.offstageX + (this.restX - this.offstageX) * eased
    this.material.alpha = BASE_ALPHA * eased * this.statePulse()
  }

  /** Drop the loaded take (texture, video, material) but keep the plane. */
  private releaseTake(): void {
    this.token++
    this.timers.clear()
    const wasActive = this.active
    this.active = false
    try {
      if (this.videoElement) {
        this.videoElement.onloadeddata = null
        this.videoElement.onerror = null
        this.videoElement.pause?.()
        this.videoElement.src = ''
        this.videoElement.load?.()
        this.videoElement.remove?.()
      }
      this.texture?.dispose()
      this.material?.dispose()
    } catch (err) {
      console.warn('[DisplayCharacter] Error releasing take:', err)
    } finally {
      this.videoElement = null
      this.texture = null
      this.material = null
      if (this.mesh) {
        this.mesh.material = null
        this.mesh.isVisible = false
      }
    }
    if (wasActive) this.onActiveChange(false)
  }
}
