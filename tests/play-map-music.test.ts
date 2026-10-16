import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SoundSystem } from '../src/game-elements/sound-system'
import type { MusicTrack } from '../src/audio/sound-system-samples'

/** A SoundSystem past `initialize()` far enough for playMapMusic's guard, with only stem tracks cached. */
function readySystem(cache: MusicTrack[] = []): SoundSystem {
  const system = new SoundSystem()
  system.isInitialized = true
  system.audioContext = { currentTime: 0 } as AudioContext
  system.musicMasterGain = {} as GainNode
  for (const track of cache) system.musicCache.set(track.id, track)
  return system
}

const stem = (name: string): MusicTrack => ({
  id: `stem-${name}`,
  title: name,
  artist: 'Nexus Cascade',
  url: `audio/${name}.ogg`,
  duration: 60,
  map_id: name,
})

describe('playMapMusic with no matching track (#455)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let debugSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be touched'))
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns quietly without a fetch or a warning when the cache holds only other stems', async () => {
    const system = readySystem([stem('menu')])

    await system.playMapMusic('neon-helix')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    // Still diagnosable in dev builds, where console.debug is not stripped.
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('neon-helix'))
  })

  it('does the same on an empty cache', async () => {
    await readySystem().playMapMusic('pachinko-hall')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('fetchMusicTracks stays a no-op: no request fires on boot', async () => {
    await readySystem().fetchMusicTracks()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('control: a cached track for the map does fetch, so the spy would catch a regression', async () => {
    fetchSpy.mockResolvedValue({ ok: false } as Response)
    const system = readySystem([stem('menu')])

    await system.playMapMusic('menu')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith('audio/menu.ogg')
    // The failure path is a real warning and stays one.
    expect(warnSpy).toHaveBeenCalled()
  })
})
