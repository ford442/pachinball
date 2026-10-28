/**
 * One asset-URL resolver for every base the game is served under (#464 item 5).
 * Production is `base: './'` mounted at /pachinball/; the dev server is `/`.
 */

import { describe, expect, it } from 'vitest'
import { assetUrl, resolveAbsoluteAssetUrl, resolveAssetUrl } from '../src/core/asset-urls'

const CDN = 'https://storage.noahcohn.com/pachinball/backbox/attract.mp4'

describe('assetUrl', () => {
  it.each([
    ['./', 'audio/pachinko-voice-processor.js', './audio/pachinko-voice-processor.js'],
    ['./', '/audio/pachinko-voice-processor.js', './audio/pachinko-voice-processor.js'],
    ['./', './maps.json', './maps.json'],
    ['', 'maps.json', './maps.json'],
    ['.', 'maps.json', './maps.json'],
    ['/', 'textures/environment.env', '/textures/environment.env'],
    ['/pachinball/', 'assets/particle.png', '/pachinball/assets/particle.png'],
    ['/pachinball', '/assets/shard.png', '/pachinball/assets/shard.png'],
  ])('base %j + %j → %j', (base, path, expected) => {
    expect(assetUrl(path, base)).toBe(expected)
  })

  it('passes URLs that already say where they live through', () => {
    for (const url of [CDN, 'http://localhost:8000/pachinball/x.png', 'data:image/png;base64,AA', 'blob:http://x/1']) {
      expect(assetUrl(url, '/pachinball/')).toBe(url)
    }
  })

  it('defaults to the build base (Vitest serves "/")', () => {
    expect(assetUrl('audio/flipper.ogg')).toBe('/audio/flipper.ogg')
  })
})

describe('resolveAssetUrl', () => {
  it('maps a missing or empty path to undefined', () => {
    expect(resolveAssetUrl(undefined, './')).toBeUndefined()
    expect(resolveAssetUrl('', './')).toBeUndefined()
  })

  it('resolves like assetUrl otherwise', () => {
    expect(resolveAssetUrl('videos/zones/a.mp4', './')).toBe('./videos/zones/a.mp4')
    expect(resolveAssetUrl(CDN, './')).toBe(CDN)
  })
})

describe('resolveAbsoluteAssetUrl', () => {
  const worklet = 'audio/pachinko-voice-processor.js'
  const expected = 'https://test.1ink.us/pachinball/audio/pachinko-voice-processor.js'

  it('lands under the subdirectory with or without the trailing slash', () => {
    expect(resolveAbsoluteAssetUrl(worklet, './', 'https://test.1ink.us/pachinball/')).toBe(expected)
    expect(resolveAbsoluteAssetUrl(worklet, './', 'https://test.1ink.us/pachinball')).toBe(expected)
    expect(resolveAbsoluteAssetUrl(worklet, './', 'https://test.1ink.us/pachinball/index.html?seed=1#x')).toBe(expected)
  })

  it('never resolves a public path against the origin root under a relative base', () => {
    expect(resolveAbsoluteAssetUrl(`/${worklet}`, './', 'https://test.1ink.us/pachinball/')).toBe(expected)
  })

  it('honours an absolute base and passes absolute URLs through', () => {
    expect(resolveAbsoluteAssetUrl(worklet, '/pachinball/', 'http://localhost:4174/pachinball/')).toBe(
      'http://localhost:4174/pachinball/audio/pachinko-voice-processor.js',
    )
    expect(resolveAbsoluteAssetUrl(worklet, '/', 'http://localhost:5173/')).toBe(
      'http://localhost:5173/audio/pachinko-voice-processor.js',
    )
    expect(resolveAbsoluteAssetUrl(CDN, './', 'https://test.1ink.us/pachinball/')).toBe(CDN)
  })
})
