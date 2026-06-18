/**
 * Unit tests for the slot machine mini-game logic.
 *
 * These tests exercise the pure-logic engine in src/display/slot-logic.ts.
 * No Babylon.js, Rapier, DOM, or WebAudio is imported — they run in plain Node.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  SlotSymbol,
  SlotActivationMode,
  type SlotMachineConfig,
  type SlotActivationState,
} from '../src/display/slot-types'
import {
  DEFAULT_SLOT_MACHINE_CONFIG,
  pickWeightedSymbol,
  generateSpin,
  countSymbol,
  checkWin,
  shouldActivate,
  recordActivation,
  clamp,
} from '../src/display/slot-logic'

describe('slot-logic', () => {
  const config: SlotMachineConfig = DEFAULT_SLOT_MACHINE_CONFIG

  describe('pickWeightedSymbol', () => {
    it('returns a symbol from the configured set', () => {
      const symbol = pickWeightedSymbol(Math.random, config)
      expect(config.symbols).toContain(symbol)
    })

    it('respects a deterministic random source', () => {
      const deterministic = () => 0.001
      const symbol = pickWeightedSymbol(deterministic, config)
      // With the default weights, a tiny roll hits the first weighted symbol.
      expect(config.symbols).toContain(symbol)
    })

    it('handles a seeded RNG predictably', () => {
      let seed = 12345
      const lcg = () => {
        seed = (seed * 9301 + 49297) % 233280
        return seed / 233280
      }
      const results: SlotSymbol[] = []
      for (let i = 0; i < 100; i++) {
        results.push(pickWeightedSymbol(lcg, config))
      }
      expect(results.every((s) => config.symbols.includes(s))).toBe(true)
    })
  })

  describe('generateSpin', () => {
    it('produces a plan with 3 reels', () => {
      const plan = generateSpin(Math.random, config)
      expect(plan.reelSpeeds).toHaveLength(3)
      expect(plan.stopDelays).toHaveLength(3)
      expect(plan.targetSymbols).toHaveLength(3)
    })

    it('produces a spin duration within configured bounds', () => {
      for (let i = 0; i < 20; i++) {
        const plan = generateSpin(Math.random, config)
        expect(plan.spinDuration).toBeGreaterThanOrEqual(config.minSpinDuration)
        expect(plan.spinDuration).toBeLessThanOrEqual(config.maxSpinDuration)
      }
    })

    it('produces positive reel speeds', () => {
      const plan = generateSpin(Math.random, config)
      for (const speed of plan.reelSpeeds) {
        expect(speed).toBeGreaterThan(0)
      }
    })

    it('uses the configured stop delays', () => {
      const plan = generateSpin(Math.random, config)
      expect(plan.stopDelays).toEqual(config.reels.map((r) => r.stopDelay))
    })
  })

  describe('countSymbol', () => {
    it('counts matching symbols correctly', () => {
      expect(countSymbol([SlotSymbol.SEVEN, SlotSymbol.SEVEN, SlotSymbol.DIAMOND], SlotSymbol.SEVEN)).toBe(2)
      expect(countSymbol([SlotSymbol.CHERRY, SlotSymbol.CHERRY, SlotSymbol.CHERRY], SlotSymbol.CHERRY)).toBe(3)
      expect(countSymbol([SlotSymbol.GRAPE, SlotSymbol.STAR, SlotSymbol.BELL], SlotSymbol.SEVEN)).toBe(0)
    })
  })

  describe('checkWin', () => {
    it('detects Triple Seven jackpot', () => {
      const result = checkWin([SlotSymbol.SEVEN, SlotSymbol.SEVEN, SlotSymbol.SEVEN], config)
      expect(result.combination?.name).toBe('Triple Seven')
      expect(result.combination?.isJackpot).toBe(true)
      expect(result.points).toBe(config.jackpotPoints)
      expect(result.nearMiss).toBe(false)
    })

    it('detects Diamond Rush', () => {
      const result = checkWin([SlotSymbol.DIAMOND, SlotSymbol.DIAMOND, SlotSymbol.DIAMOND], config)
      expect(result.combination?.name).toBe('Diamond Rush')
      expect(result.combination?.multiplier).toBe(5)
      expect(result.points).toBe(500)
      expect(result.nearMiss).toBe(false)
    })

    it('detects Lucky Bells', () => {
      const result = checkWin([SlotSymbol.BELL, SlotSymbol.BELL, SlotSymbol.BELL], config)
      expect(result.combination?.name).toBe('Lucky Bells')
      expect(result.combination?.multiplier).toBe(3)
      expect(result.points).toBe(300)
    })

    it('detects Cherry Pick', () => {
      const result = checkWin([SlotSymbol.CHERRY, SlotSymbol.CHERRY, SlotSymbol.CHERRY], config)
      expect(result.combination?.name).toBe('Cherry Pick')
      expect(result.combination?.multiplier).toBe(2)
      expect(result.points).toBe(200)
    })

    it('detects Double Seven', () => {
      const result = checkWin([SlotSymbol.SEVEN, SlotSymbol.SEVEN, SlotSymbol.CHERRY], config)
      expect(result.combination?.name).toBe('Double Seven')
      expect(result.combination?.multiplier).toBe(2)
      expect(result.points).toBe(200)
      expect(result.nearMiss).toBe(true)
    })

    it('flags a near-miss when exactly two sevens appear without a jackpot/double win', () => {
      // The Double Seven combo wins before the near-miss path, so the only
      // "pure" near-miss in this paytable is two sevens plus a non-seven.
      // That still maps to Double Seven, which is marked nearMiss=true.
      const result = checkWin([SlotSymbol.SEVEN, SlotSymbol.SEVEN, SlotSymbol.DIAMOND], config)
      expect(result.nearMiss).toBe(true)
    })

    it('returns no win for three mismatched symbols', () => {
      const result = checkWin([SlotSymbol.GRAPE, SlotSymbol.STAR, SlotSymbol.BELL], config)
      expect(result.combination).toBeNull()
      expect(result.points).toBe(0)
      expect(result.nearMiss).toBe(false)
    })

    it('returns no win for three grapes', () => {
      const result = checkWin([SlotSymbol.GRAPE, SlotSymbol.GRAPE, SlotSymbol.GRAPE], config)
      expect(result.combination).toBeNull()
      expect(result.points).toBe(0)
      expect(result.nearMiss).toBe(false)
    })
  })

  describe('shouldActivate', () => {
    let state: SlotActivationState

    beforeEach(() => {
      state = {
        lastActivationTime: 0,
        lastActivationScore: 0,
        isSpinning: false,
      }
    })

    it('ALWAYS mode activates after cooldown', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.ALWAYS }
      expect(shouldActivate(() => 0, 0, cfg.cooldownSeconds, state, cfg)).toBe(true)
    })

    it('ALWAYS mode respects cooldown', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.ALWAYS }
      expect(shouldActivate(() => 0, 0, cfg.cooldownSeconds - 0.1, state, cfg)).toBe(false)
    })

    it('ALWAYS mode does not activate while spinning', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.ALWAYS }
      state.isSpinning = true
      expect(shouldActivate(() => 0, 0, cfg.cooldownSeconds + 1, state, cfg)).toBe(false)
    })

    it('CHANCE mode activates on a low roll after cooldown', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.CHANCE }
      expect(shouldActivate(() => 0.1, 0, cfg.cooldownSeconds, state, cfg)).toBe(true)
    })

    it('CHANCE mode does not activate on a high roll', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.CHANCE }
      expect(shouldActivate(() => 0.9, 0, cfg.cooldownSeconds, state, cfg)).toBe(false)
    })

    it('SCORE mode activates when threshold is crossed', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.SCORE }
      expect(shouldActivate(() => 0, cfg.scoreThreshold, cfg.cooldownSeconds, state, cfg)).toBe(true)
    })

    it('SCORE mode does not activate before threshold', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.SCORE }
      expect(shouldActivate(() => 0, cfg.scoreThreshold - 1, cfg.cooldownSeconds, state, cfg)).toBe(false)
    })

    it('HYBRID mode activates on score threshold even with high chance roll', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.HYBRID }
      expect(shouldActivate(() => 0.99, cfg.scoreThreshold, cfg.cooldownSeconds, state, cfg)).toBe(true)
    })

    it('HYBRID mode activates on chance roll even without score threshold', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.HYBRID }
      expect(shouldActivate(() => 0.1, 0, cfg.cooldownSeconds, state, cfg)).toBe(true)
    })

    it('HYBRID mode does not activate when neither condition is met', () => {
      const cfg: SlotMachineConfig = { ...config, activationMode: SlotActivationMode.HYBRID }
      expect(shouldActivate(() => 0.99, 0, cfg.cooldownSeconds, state, cfg)).toBe(false)
    })
  })

  describe('recordActivation', () => {
    it('updates activation state and marks spinning', () => {
      const state: SlotActivationState = {
        lastActivationTime: 0,
        lastActivationScore: 0,
        isSpinning: false,
      }
      recordActivation(state, 12.5, 5000)
      expect(state.lastActivationTime).toBe(12.5)
      expect(state.lastActivationScore).toBe(5000)
      expect(state.isSpinning).toBe(true)
    })
  })

  describe('clamp', () => {
    it('clamps values between min and max', () => {
      expect(clamp(5, 0, 10)).toBe(5)
      expect(clamp(-2, 0, 10)).toBe(0)
      expect(clamp(15, 0, 10)).toBe(10)
    })
  })
})
