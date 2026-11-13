/**
 * What a display state shows: which layers are visible, which media they load, and the cabinet
 * lighting the state asks for.
 *
 * Split out of `display-core.ts`'s `setDisplayState`. `DisplaySystem` keeps the state machine (what
 * the current state is, and when it changes); this module turns one state's config into calls on the
 * layer modules.
 */

import { DisplayState, type StateMediaConfig } from './display-types'
import type { DisplayShaderLayer } from './display-shader'
import type { DisplayReelsLayer } from './display-reels'
import type { DisplayPhysicalLayer } from './display-physical'
import type { DisplayVideoLayer } from './display-video'
import type { DisplayImageLayer } from './display-image'

/** The layers a state's media config drives. */
export interface StateMediaLayers {
  shader: Pick<DisplayShaderLayer, 'setBackgroundVisible' | 'setShaderParams'>
  reels: Pick<DisplayReelsLayer, 'setVisible'>
  physical: Pick<DisplayPhysicalLayer, 'setVisible'>
  video: Pick<DisplayVideoLayer, 'loadVideo' | 'setVisible'>
  image: Pick<DisplayImageLayer, 'loadImage' | 'setVisible'>
}

/** Apply one state's visibility and media to the layer stack. */
export function applyStateMedia(layers: StateMediaLayers, media: StateMediaConfig): void {
  const { shader, reels, physical, video, image } = layers
  shader.setBackgroundVisible(media.showShaderBackground ?? true)
  reels.setVisible(media.showReels ?? true)
  physical.setVisible(media.showShaderBackground ?? true)

  if (media.shaderParams) {
    shader.setShaderParams(media.shaderParams)
  }

  // The character take is its own plane over this stack; it never takes the video / image slot.
  const videoUrl = media.videoPath || ''
  const imageUrl = media.imagePath || ''

  if (videoUrl) {
    video.loadVideo(videoUrl)
    video.setVisible(true)
  } else {
    video.setVisible(false)
  }

  if (imageUrl) {
    image.loadImage(imageUrl, media.opacity ?? 1.0)
    image.setVisible(true)
  } else {
    image.setVisible(false)
  }

  if (!videoUrl && !imageUrl) {
    shader.setBackgroundVisible(true)
    reels.setVisible(true)
  }
}

export function lightingModeForState(state: DisplayState): 'normal' | 'reach' | 'fever' | 'hit' {
  switch (state) {
    case DisplayState.REACH:
    case DisplayState.PORTAL_OPEN:
    case DisplayState.ESCAPE:
      return 'reach'
    case DisplayState.FEVER:
    case DisplayState.JACKPOT:
      return 'fever'
    default:
      return 'normal'
  }
}
