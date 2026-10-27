/**
 * Mirror texture refresh cadence per quality tier.
 *
 * HIGH redraws the mirror every frame; MEDIUM and LOW every second frame. Pure so it unit-tests
 * without the engine mock.
 *
 * Never resize the mirror on a tier change: on Babylon 7.54 resizing a MirrorTexture that has a
 * blur kernel is broken (fixed upstream after 7.54). Its size is picked once, at creation
 * (`mirrorSizeHigh` / `mirrorSizeMedium` in config), and only the refresh rate follows the tier.
 */

import { QualityTier } from '../game-elements/visual-language'

export function resolveMirrorRefreshRate(tier: QualityTier): number {
  return tier === QualityTier.HIGH ? 1 : 2
}
