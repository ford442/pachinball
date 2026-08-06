import { describe, it, expect } from 'vitest'
import {
  getJackpotPhaseSampleKey,
  getLocalAudioPath,
  getSampleKeyForCategory,
  getSampleKeyForImpact,
  LOCAL_SAMPLE_BANK,
} from '../src/game-elements/audio-sample-bank'

describe('audio-sample-bank', () => {
  it('maps impact categories to sample keys', () => {
    expect(getSampleKeyForImpact('bumper')).toBe('bumper')
    expect(getSampleKeyForImpact('flipper')).toBe('flipper')
    expect(getSampleKeyForImpact('launch')).toBeUndefined()
  })

  it('maps sample categories for arcade SFX', () => {
    expect(getSampleKeyForCategory('flipper')).toBe('flipper')
    expect(getSampleKeyForCategory('launch')).toBeUndefined()
  })

  it('resolves jackpot phase keys', () => {
    expect(getJackpotPhaseSampleKey(1)).toBe('jackpot-phase1')
    expect(getJackpotPhaseSampleKey(2)).toBe('jackpot-phase2')
    expect(getJackpotPhaseSampleKey(3)).toBe('jackpot-phase3')
    expect(getJackpotPhaseSampleKey(0)).toBeUndefined()
  })

  it('builds public audio paths under BASE_URL', () => {
    expect(getLocalAudioPath('flipper.ogg')).toContain('audio/flipper.ogg')
  })

  it('defines all proposed bank entries', () => {
    const keys = LOCAL_SAMPLE_BANK.map((def) => def.key)
    expect(keys).toEqual(expect.arrayContaining([
      'flipper',
      'bumper',
      'drain',
      'gold-collect',
      'jackpot-phase1',
      'jackpot-phase2',
      'jackpot-phase3',
      'portal',
      'slot-stop',
    ]))
  })
})
