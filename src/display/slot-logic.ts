/**
 * Slot Machine Logic Engine
 *
 * Pure, deterministic logic for the backbox slot mini-game.
 * No Babylon.js / Rapier / DOM dependencies — fully unit-testable.
 */

import { SLOT_MACHINE_CONFIG } from '../config'
import {
  SlotSymbol,
  SlotActivationMode,
  SlotSpinState,
  type SlotMachineConfig,
  type SlotReelConfig,
  type SlotWinCombination,
  type SlotSpinPlan,
  type SlotResult,
  type SlotActivationState,
} from './slot-types'

export { SlotSymbol, SlotActivationMode, SlotSpinState }
export type {
  SlotMachineConfig,
  SlotReelConfig,
  SlotWinCombination,
  SlotSpinPlan,
  SlotResult,
  SlotActivationState,
}

/** Re-export default configuration so tests and runtime share one source of truth. */
export { SLOT_MACHINE_CONFIG as DEFAULT_SLOT_MACHINE_CONFIG }

/** Validate that symbol weights sum to roughly 1.0 */
export function validateSymbolWeights(weights: Record<SlotSymbol, number>): void {
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0)
  if (total <= 0) {
    throw new Error(`[SlotLogic] Symbol weights must sum to > 0, got ${total}`)
  }
  if (Math.abs(total - 1.0) > 0.001) {
    console.warn(`[SlotLogic] Symbol weights sum to ${total}, normalizing`)
  }
}

/** Pick a single symbol using the configured weights. */
export function pickWeightedSymbol(
  random: () => number,
  config: Pick<SlotMachineConfig, 'symbols' | 'symbolWeights'>
): SlotSymbol {
  const { symbols, symbolWeights } = config
  const totalWeight = symbols.reduce((sum, s) => sum + (symbolWeights[s] ?? 0), 0)
  let roll = random() * totalWeight

  for (const symbol of symbols) {
    const weight = symbolWeights[symbol] ?? 0
    if (roll < weight) return symbol
    roll -= weight
  }

  // Fallback to last symbol (handles floating-point edge cases)
  return symbols[symbols.length - 1]
}

/** Generate a complete spin plan: speeds, staggered stops, and final symbols. */
export function generateSpin(
  random: () => number,
  config: Pick<SlotMachineConfig, 'reels' | 'minSpinDuration' | 'maxSpinDuration' | 'symbols' | 'symbolWeights'>
): SlotSpinPlan {
  const { reels, minSpinDuration, maxSpinDuration } = config
  const spinDuration = minSpinDuration + random() * (maxSpinDuration - minSpinDuration)

  const reelSpeeds: number[] = []
  const stopDelays: number[] = []
  const targetSymbols: SlotSymbol[] = []

  for (const reel of reels) {
    const variance = random() * reel.speedVariance * 2 - reel.speedVariance
    reelSpeeds.push(Math.max(0.5, reel.baseSpeed + variance))
    stopDelays.push(reel.stopDelay)
    targetSymbols.push(pickWeightedSymbol(random, config))
  }

  return {
    spinDuration,
    reelSpeeds,
    stopDelays,
    targetSymbols,
  }
}

/** Count how many reels show the given symbol. */
export function countSymbol(symbols: SlotSymbol[], symbol: SlotSymbol): number {
  return symbols.filter((s) => s === symbol).length
}

/**
 * Evaluate the final reel symbols and return the result.
 * Combinations are checked in config order; the first match wins.
 */
export function checkWin(
  symbols: SlotSymbol[],
  config: Pick<SlotMachineConfig, 'winCombinations' | 'basePoints' | 'jackpotPoints'>
): SlotResult {
  const sevenCount = countSymbol(symbols, SlotSymbol.SEVEN)

  for (const combo of config.winCombinations) {
    if (combo.symbol === null) {
      // Any triple
      if (symbols.every((s) => s === symbols[0]) && symbols.length === combo.matchCount) {
        return makeResult(combo, symbols, config)
      }
      continue
    }

    const matched = countSymbol(symbols, combo.symbol)
    if (matched >= combo.matchCount) {
      return makeResult(combo, symbols, config)
    }
  }

  // Near miss: exactly two sevens showing on the reels.
  // Note: Double Seven is still flagged as a near-miss because the PLAN
  // treats two sevens as a tension beat even when it also pays out.
  const nearMiss = sevenCount === 2

  return {
    combination: null,
    symbols,
    points: 0,
    nearMiss,
  }
}

function makeResult(
  combo: SlotWinCombination,
  symbols: SlotSymbol[],
  config: Pick<SlotMachineConfig, 'basePoints' | 'jackpotPoints'>
): SlotResult {
  const points = combo.isJackpot
    ? config.jackpotPoints
    : combo.multiplier * config.basePoints

  // Any two-sevens board is a tension near-miss, including the Double Seven payout.
  const nearMiss = countSymbol(symbols, SlotSymbol.SEVEN) === 2

  return {
    combination: combo,
    symbols,
    points,
    nearMiss,
  }
}

/**
 * Determine whether the slot machine may activate right now.
 *
 * Rules:
 * - ALWAYS: activate if cooldown elapsed.
 * - CHANCE: activate if cooldown elapsed AND random roll < chancePercent.
 * - SCORE: activate when score has crossed a threshold since last activation.
 * - HYBRID: activate if cooldown elapsed AND (chance roll OR score threshold crossed).
 */
export function shouldActivate(
  random: () => number,
  currentScore: number,
  currentTime: number,
  state: SlotActivationState,
  config: Pick<SlotMachineConfig, 'activationMode' | 'chancePercent' | 'scoreThreshold' | 'cooldownSeconds'>
): boolean {
  if (state.isSpinning) return false

  const cooldownOk = currentTime - state.lastActivationTime >= config.cooldownSeconds
  if (!cooldownOk) return false

  switch (config.activationMode) {
    case SlotActivationMode.ALWAYS:
      return true

    case SlotActivationMode.CHANCE:
      return random() < config.chancePercent

    case SlotActivationMode.SCORE: {
      const scoreDelta = currentScore - state.lastActivationScore
      return scoreDelta >= config.scoreThreshold
    }

    case SlotActivationMode.HYBRID: {
      const scoreDelta = currentScore - state.lastActivationScore
      const scoreTriggered = scoreDelta >= config.scoreThreshold
      const chanceTriggered = random() < config.chancePercent
      return scoreTriggered || chanceTriggered
    }

    default:
      return false
  }
}

/** Mark the slot machine as having just activated at the given time/score. */
export function recordActivation(
  state: SlotActivationState,
  currentTime: number,
  currentScore: number
): void {
  state.lastActivationTime = currentTime
  state.lastActivationScore = currentScore
  state.isSpinning = true
}

/** Clamp a value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Convert a spin-state enum into a lighting-mode string for EffectsSystem. */
export function spinStateToLightMode(
  state: SlotSpinState
): 'idle' | 'spin' | 'stop' | 'win' | 'jackpot' {
  switch (state) {
    case SlotSpinState.SPINNING:
    case SlotSpinState.STARTING:
      return 'spin'
    case SlotSpinState.STOPPING:
      return 'stop'
    case SlotSpinState.JACKPOT:
      return 'jackpot'
    case SlotSpinState.STOPPED:
      return 'win'
    case SlotSpinState.IDLE:
    default:
      return 'idle'
  }
}
