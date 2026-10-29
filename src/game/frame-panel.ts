/**
 * The debug HUD's "Frame" panel: per-phase CPU time from the frame scheduler and the resolution
 * policy's state (#488 §3–4). Only built while the HUD is visible.
 */

import { FRAME_PHASES, type FramePhaseTimings } from '../core/frame-scheduler'
import type { RenderResolutionInfo } from './render-resolution'

export function formatFramePanel(
  timings: FramePhaseTimings,
  resolution: RenderResolutionInfo | null,
): Record<string, string | number> {
  const panel: Record<string, string | number> = { 'cpu total': `${timings.total.toFixed(2)} ms` }
  for (const phase of FRAME_PHASES) {
    panel[phase] = `${timings.phases[phase].toFixed(2)} ms`
  }
  if (resolution) {
    panel['render scale'] = `${resolution.scale.toFixed(3)}x (${resolution.minScale.toFixed(2)}–${resolution.maxScale.toFixed(2)})`
    panel['dynamic res'] = resolution.dynamic ? `${resolution.source}, ${resolution.changes} changes` : 'off'
    panel.DPR = resolution.devicePixelRatio
  }
  return panel
}
