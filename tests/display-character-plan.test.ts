import { describe, it, expect } from 'vitest'
import { planCharacterMedia } from '../src/display/display-character'
import { DisplayState, type StateMediaConfig } from '../src/game-elements/display-config'
import { QualityTier } from '../src/game-elements/visual-language'

const MOTION_OK = { reducedMotion: false, photosensitive: false }

const idle: StateMediaConfig = {
  videoPath: '/backbox/attract.mp4',
  imagePath: '/backbox/attract.png',
  characterLayer: '/backbox/nexus/idle.png',
  characterLoop: '/backbox/nexus/idle.webm',
  showReels: false,
}

const reach: StateMediaConfig = {
  videoPath: '/backbox/reach.mp4',
  imagePath: '/backbox/reach.png',
  characterLayer: '/backbox/nexus/reach.png',
  showReels: true,
}

describe('planCharacterMedia', () => {
  it('plays the loop over the poster when motion is allowed', () => {
    const plan = planCharacterMedia(idle, DisplayState.IDLE, MOTION_OK, QualityTier.MEDIUM)
    expect(plan.posterUrl).toBe('/backbox/nexus/idle.png')
    expect(plan.loopUrl).toBe('/backbox/nexus/idle.webm')
    expect(plan.loopSkippedReason).toBeUndefined()
  })

  it('reduced motion keeps the static poster', () => {
    const plan = planCharacterMedia(idle, DisplayState.IDLE, { reducedMotion: true, photosensitive: false }, QualityTier.HIGH)
    expect(plan.posterUrl).toBe('/backbox/nexus/idle.png')
    expect(plan.loopUrl).toBeNull()
    expect(plan.loopSkippedReason).toBe('reduced-motion')
  })

  it('photosensitive mode skips loops only in the flashing states', () => {
    const a11y = { reducedMotion: false, photosensitive: true }
    const withLoop = { ...reach, characterLoop: '/x.webm' }
    expect(planCharacterMedia(withLoop, DisplayState.FEVER, a11y, QualityTier.HIGH).loopSkippedReason).toBe('photosensitive')
    expect(planCharacterMedia(withLoop, DisplayState.JACKPOT, a11y, QualityTier.HIGH).loopSkippedReason).toBe('photosensitive')
    expect(planCharacterMedia(idle, DisplayState.IDLE, a11y, QualityTier.HIGH).loopUrl).toBe('/backbox/nexus/idle.webm')
  })

  it('LOW tier skips the loop', () => {
    const plan = planCharacterMedia(idle, DisplayState.IDLE, MOTION_OK, QualityTier.LOW)
    expect(plan.loopUrl).toBeNull()
    expect(plan.loopSkippedReason).toBe('low-tier')
  })

  it('suppresses the state video only when the reels show and a poster is set', () => {
    expect(planCharacterMedia(reach, DisplayState.REACH, MOTION_OK, QualityTier.HIGH).suppressStateVideo).toBe(true)
    expect(planCharacterMedia(idle, DisplayState.IDLE, MOTION_OK, QualityTier.HIGH).suppressStateVideo).toBe(false)
    const noPoster = { ...reach, characterLayer: '' }
    const plan = planCharacterMedia(noPoster, DisplayState.REACH, MOTION_OK, QualityTier.HIGH)
    expect(plan.suppressStateVideo).toBe(false)
    expect(plan.fallbackVideoUrl).toBe('/backbox/reach.mp4')
    expect(plan.fallbackImageUrl).toBe('/backbox/reach.png')
  })

  it('treats a legacy video characterLayer as a loop with no poster', () => {
    const legacy = { characterLayer: '/backbox/nexus/fever.webm?v=2', showReels: false }
    const plan = planCharacterMedia(legacy, DisplayState.FEVER, MOTION_OK, QualityTier.HIGH)
    expect(plan.posterUrl).toBeNull()
    expect(plan.loopUrl).toBe('/backbox/nexus/fever.webm?v=2')
  })

  it('no character configured yields an empty plan', () => {
    const plan = planCharacterMedia({ videoPath: '/v.mp4' }, DisplayState.IDLE, MOTION_OK, QualityTier.HIGH)
    expect(plan.posterUrl).toBeNull()
    expect(plan.loopUrl).toBeNull()
    expect(plan.loopSkippedReason).toBeUndefined()
    expect(plan.suppressStateVideo).toBe(false)
  })
})
