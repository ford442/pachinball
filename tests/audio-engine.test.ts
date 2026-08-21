import { afterEach, describe, expect, it, vi } from 'vitest'

const createGain = () => ({
  gain: { value: 1 },
  connect: vi.fn(),
  disconnect: vi.fn(),
})

class FakeAudioContext {
  state = 'running'
  destination = {}
  audioWorklet = {
    addModule: vi.fn().mockRejectedValue(new Error('no worklet in tests')),
  }
  createGain = vi.fn(createGain)
  resume = vi.fn().mockResolvedValue(undefined)
  suspend = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockImplementation(async () => {
    this.state = 'closed'
  })
}

describe('AudioEngine', () => {
  afterEach(async () => {
    const { resetAudioEngine } = await import('../src/audio/audio-engine')
    await resetAudioEngine()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('creates exactly one context for repeated getAudioEngine() calls', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    vi.stubGlobal('webkitAudioContext', FakeAudioContext)
    const { getAudioEngine, getOwnedAudioContextCount, peekAudioEngine } = await import('../src/audio/audio-engine')
    const a = getAudioEngine()
    const b = getAudioEngine()
    expect(a).toBe(b)
    expect(getOwnedAudioContextCount()).toBe(1)
    expect(peekAudioEngine()).toBe(a)
    expect(a.sfxGain).toBeDefined()
    expect(a.hudGain).toBeDefined()
    expect(a.stemGain).toBeDefined()
    expect(a.musicGain).toBeDefined()
  })

  it('playVoice returns false when the worklet failed to load', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const { getAudioEngine } = await import('../src/audio/audio-engine')
    const engine = getAudioEngine()
    await engine.ensureWorklet()
    expect(engine.isWorkletReady()).toBe(false)
    expect(engine.playVoice({ type: 'bumper', velocity: 0.8 })).toBe(false)
  })
})
