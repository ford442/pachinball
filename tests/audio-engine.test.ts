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

class FakeWorkletNode {
  static last: FakeWorkletNode | null = null
  port = { postMessage: vi.fn() }
  connect = vi.fn()
  disconnect = vi.fn()
  private listeners = new Map<string, () => void>()
  constructor() {
    FakeWorkletNode.last = this
  }
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, fn)
  }
  fire(type: string): void {
    this.listeners.get(type)?.()
  }
}

describe('AudioEngine', () => {
  afterEach(async () => {
    const { resetAudioEngine } = await import('../src/audio/audio-engine')
    await resetAudioEngine()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
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

  it('loads the voice worklet from the deploy directory, not the origin root (#464 item 5)', async () => {
    const loaded: string[] = []
    class WorkletContext extends FakeAudioContext {
      audioWorklet = { addModule: vi.fn(async (url: string) => { loaded.push(url) }) }
    }
    vi.stubGlobal('AudioContext', WorkletContext)
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
    // The production build (base './') on the live site, opened without its trailing slash.
    vi.stubEnv('BASE_URL', './')
    vi.stubGlobal('document', { baseURI: 'https://test.1ink.us/pachinball' })
    const { getAudioEngine } = await import('../src/audio/audio-engine')
    const engine = getAudioEngine()
    expect(await engine.ensureWorklet()).toBe(true)
    expect(loaded).toEqual(['https://test.1ink.us/pachinball/audio/pachinko-voice-processor.js'])
    expect(engine.getWorkletStatus()).toEqual({
      url: 'https://test.1ink.us/pachinball/audio/pachinko-voice-processor.js',
      ready: true,
      error: null,
    })
  })

  it('a processor error hands the voices back to the oscillator fallback', async () => {
    class WorkletContext extends FakeAudioContext {
      audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) }
    }
    vi.stubGlobal('AudioContext', WorkletContext)
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
    vi.stubGlobal('document', { baseURI: 'http://localhost:5173/' })
    const { getAudioEngine } = await import('../src/audio/audio-engine')
    const engine = getAudioEngine()
    await engine.ensureWorklet()
    expect(engine.playVoice({ type: 'bumper', velocity: 0.8 })).toBe(true)
    FakeWorkletNode.last?.fire('processorerror')
    expect(engine.playVoice({ type: 'bumper', velocity: 0.8 })).toBe(false)
    expect(engine.getWorkletStatus()).toMatchObject({ ready: false, error: 'processorerror' })
    expect(await engine.ensureWorklet()).toBe(false)
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
