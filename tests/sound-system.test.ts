import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @babylonjs/core since SoundSystem imports Vector3
vi.mock('@babylonjs/core', () => ({
  Vector3: vi.fn().mockImplementation((x = 0, y = 0, z = 0) => ({ x, y, z })),
}))

import { SoundSystem } from '../src/game-elements/sound-system'

describe('SoundSystem', () => {
  let soundSystem: SoundSystem

  beforeEach(() => {
    soundSystem = new SoundSystem()
  })

  describe('createSynthesizedGameSounds', () => {
    it('creates all 7 sample categories with valid AudioBuffers', () => {
      // Mock Web Audio API
      const mockCreateBuffer = vi.fn().mockImplementation((
        numberOfChannels: number,
        length: number,
        sampleRate: number
      ) => {
        const buf = {
          numberOfChannels,
          length,
          sampleRate,
          duration: length / sampleRate,
          getChannelData: vi.fn().mockReturnValue(new Float32Array(length)),
        } as unknown as AudioBuffer
        return buf
      })

      const mockAudioContext = {
        sampleRate: 48000,
        createBuffer: mockCreateBuffer,
        createGain: vi.fn().mockReturnValue({
          gain: { value: 1 },
          connect: vi.fn(),
        }),
        createOscillator: vi.fn().mockReturnValue({
          type: '',
          frequency: { value: 0 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }),
        destination: {},
        state: 'running',
        resume: vi.fn().mockResolvedValue(undefined),
      } as unknown as AudioContext

      // Inject the mock context via initialize
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).audioContext = mockAudioContext
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).masterGain = mockAudioContext.createGain()

      // Call the private method directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).createSynthesizedGameSounds()

      // Verify all 7 categories were created
      const expectedCategories = ['launch', 'flipper', 'bumper', 'peg', 'drain', 'jackpot', 'fever']
      for (const cat of expectedCategories) {
        const id = `synth-${cat}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cached = (soundSystem as any).sampleCache.get(id)
        expect(cached, `expected sampleCache to have entry for ${id}`).toBeDefined()
        expect(cached.buffer).toBeDefined()
        expect(cached.buffer.numberOfChannels).toBe(1)
        expect(cached.buffer.sampleRate).toBe(48000)
        expect(cached.metadata.category).toBe(cat)
        expect(cached.metadata.id).toBe(id)
      }

      // Verify samplesByCategory map was populated
      for (const cat of expectedCategories) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = (soundSystem as any).samplesByCategory.get(cat)
        expect(list, `expected samplesByCategory to have entry for ${cat}`).toBeDefined()
        expect(list.length).toBeGreaterThanOrEqual(1)
        expect(list).toContain(`synth-${cat}`)
      }

      expect(mockCreateBuffer).toHaveBeenCalledTimes(7)
    })
  })

  describe('playImpact', () => {
    it('creates synth nodes and scales gain with velocity', () => {
      const gainEvents: number[] = []
      const makeGainNode = () => ({
        gain: {
          value: 1,
          setValueAtTime: vi.fn().mockImplementation((value: number) => gainEvents.push(value)),
          linearRampToValueAtTime: vi.fn().mockImplementation((value: number) => gainEvents.push(value)),
          exponentialRampToValueAtTime: vi.fn().mockImplementation((value: number) => gainEvents.push(value)),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })

      const mockAudioContext = {
        sampleRate: 48000,
        currentTime: 1,
        createGain: vi.fn().mockImplementation(makeGainNode),
        createOscillator: vi.fn().mockReturnValue({
          type: 'sine',
          frequency: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }),
        createBiquadFilter: vi.fn().mockReturnValue({
          type: 'lowpass',
          frequency: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          Q: { value: 0 },
          connect: vi.fn(),
        }),
        createBuffer: vi.fn().mockImplementation((channels: number, length: number, sampleRate: number) => ({
          numberOfChannels: channels,
          length,
          sampleRate,
          getChannelData: vi.fn().mockReturnValue(new Float32Array(length)),
        })),
        createBufferSource: vi.fn().mockReturnValue({
          buffer: null,
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }),
        destination: {},
        state: 'running',
        resume: vi.fn().mockResolvedValue(undefined),
      } as unknown as AudioContext

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).audioContext = mockAudioContext
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).sfxGain = makeGainNode()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).isInitialized = true

      soundSystem.playImpact('bumper', 4)
      const firstPeak = Math.max(...gainEvents)
      gainEvents.length = 0

      ;(mockAudioContext as unknown as { currentTime: number }).currentTime = 2
      soundSystem.playImpact('bumper', 18)
      const secondPeak = Math.max(...gainEvents)

      expect(mockAudioContext.createOscillator).toHaveBeenCalled()
      expect(mockAudioContext.createBufferSource).toHaveBeenCalled()
      expect(secondPeak).toBeGreaterThan(firstPeak)
    })
  })

  describe('playJackpotPhase', () => {
    it('dedupes repeated phase triggers', () => {
      const mockCreateBufferSource = vi.fn().mockReturnValue({
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start: vi.fn(),
        onended: null,
      })

      const mockAudioContext = {
        sampleRate: 48000,
        createGain: vi.fn().mockReturnValue({
          gain: { value: 1 },
          connect: vi.fn(),
        }),
        createBufferSource: mockCreateBufferSource,
        destination: {},
        state: 'running',
      } as unknown as AudioContext

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).audioContext = mockAudioContext
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).sfxGain = mockAudioContext.createGain()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).isInitialized = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).audioSource = 'samples'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).sampleBankReady = true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(soundSystem as any).localSampleBuffers.set('jackpot-phase1', { duration: 0.5 } as AudioBuffer)

      soundSystem.playJackpotPhase(1)
      soundSystem.playJackpotPhase(1)

      expect(mockCreateBufferSource).toHaveBeenCalledTimes(1)
    })
  })
})
