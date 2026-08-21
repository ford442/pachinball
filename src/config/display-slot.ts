import { SlotActivationMode, SlotSymbol, type SlotMachineConfig } from '../display/slot-types'

/**
 * Slot Machine Configuration
 * 3 reels, 6 symbols, weighted spawns, config-driven payouts.
 * Used by the backbox slot mini-game activated on REACH / FEVER.
 *
 * Isolated value import of slot-types: this is the only config module allowed
 * to import from `src/display/slot-types` (enums are needed at runtime).
 */
export const SLOT_MACHINE_CONFIG: SlotMachineConfig = {
  activationMode: SlotActivationMode.HYBRID,
  chancePercent: 0.3,
  scoreThreshold: 10000,
  minSpinDuration: 1.0,
  maxSpinDuration: 3.0,
  reels: [
    { baseSpeed: 8, speedVariance: 2, stopDelay: 0 },
    { baseSpeed: 10, speedVariance: 3, stopDelay: 0.2 },
    { baseSpeed: 6, speedVariance: 1.5, stopDelay: 0.4 },
  ],
  symbols: [
    SlotSymbol.SEVEN,
    SlotSymbol.DIAMOND,
    SlotSymbol.BELL,
    SlotSymbol.CHERRY,
    SlotSymbol.GRAPE,
    SlotSymbol.STAR,
  ],
  symbolWeights: {
    [SlotSymbol.SEVEN]: 0.06,
    [SlotSymbol.DIAMOND]: 0.12,
    [SlotSymbol.BELL]: 0.18,
    [SlotSymbol.CHERRY]: 0.22,
    [SlotSymbol.GRAPE]: 0.21,
    [SlotSymbol.STAR]: 0.21,
  },
  winCombinations: [
    {
      name: 'Triple Seven',
      symbol: SlotSymbol.SEVEN,
      matchCount: 3,
      multiplier: 10,
      points: 100000,
      isJackpot: true,
    },
    {
      name: 'Diamond Rush',
      symbol: SlotSymbol.DIAMOND,
      matchCount: 3,
      multiplier: 5,
      points: 500,
      isJackpot: false,
    },
    {
      name: 'Lucky Bells',
      symbol: SlotSymbol.BELL,
      matchCount: 3,
      multiplier: 3,
      points: 300,
      isJackpot: false,
    },
    {
      name: 'Cherry Pick',
      symbol: SlotSymbol.CHERRY,
      matchCount: 3,
      multiplier: 2,
      points: 200,
      isJackpot: false,
    },
    {
      name: 'Double Seven',
      symbol: SlotSymbol.SEVEN,
      matchCount: 2,
      multiplier: 2,
      points: 200,
      isJackpot: false,
    },
  ],
  basePoints: 100,
  jackpotPoints: 100000,
  cooldownSeconds: 4.0,
  enableSounds: true,
  enableLightEffects: true,
}
