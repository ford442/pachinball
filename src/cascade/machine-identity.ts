/**
 * Daily Cascade machine identity — a named machine for a seeded layout.
 *
 * Pure and deterministic: the same layout always yields the same name, series
 * number, trait line and backbox pick, on every client. The name comes from a
 * fork of the layout seed that is independent of the layout's own stream, so
 * layout generation can change without renaming machines.
 *
 * The word lists are APPEND-ONLY. Reordering or editing an entry renames every
 * past machine that drew it (tests/machine-identity.test.ts pins a few titles).
 */

import { createSeededRng } from '../core/seeded-rng'
import { CANONICAL_BUMPERS, FEEDER_KEYS, type FeederKey, type TableLayout } from './daily-cascade-layout'

const ADJECTIVES = [
  'Velvet', 'Chrome', 'Neon', 'Molten', 'Static', 'Hollow', 'Gilded', 'Midnight',
  'Copper', 'Phantom', 'Electric', 'Quiet', 'Rapid', 'Lucky', 'Crimson', 'Silver',
  'Cobalt', 'Feral', 'Glass', 'Iron', 'Lunar', 'Solar', 'Violet', 'Amber',
  'Rogue', 'Twin', 'Golden', 'Shadow', 'Prism', 'Arc', 'Turbo', 'Ember',
] as const

const NOUNS = [
  'Turbine', 'Cascade', 'Engine', 'Lantern', 'Reactor', 'Comet', 'Cathedral', 'Foundry',
  'Orchard', 'Signal', 'Vault', 'Carousel', 'Monarch', 'Circuit', 'Harbor', 'Beacon',
  'Furnace', 'Satellite', 'Labyrinth', 'Waterfall', 'Jukebox', 'Hive', 'Pagoda', 'Dynamo',
  'Meteor', 'Arcade', 'Spire', 'Loom', 'Tempest', 'Garden', 'Relay', 'Crown',
] as const

/** Fork salt ("mach"): keeps naming independent of the layout's RNG stream. */
const NAME_FORK = 0x6d616368

export const FEEDER_LABELS: Record<FeederKey, string> = {
  magSpin: 'Mag-Spin',
  nanoLoom: 'Nano-Loom',
  prismCore: 'Prism Core',
  gaussCannon: 'Gauss Cannon',
  quantumTunnel: 'Quantum Tunnel',
}

export type PinDensity = 'sparse' | 'standard' | 'dense'
export type BumperSpread = 'tight' | 'loose'

export interface MachineTraits {
  pinCount: number
  pinDensity: PinDensity
  activeFeeders: FeederKey[]
  bumperSpread: BumperSpread
}

/** Backbox look for the machine, consumed by DisplaySystem.setMachineTheme. */
export interface MachineBackboxPick {
  /** 0–359 */
  hue: number
  primaryHex: string
  accentHex: string
  /** IDLE shader grid speed. */
  shaderSpeed: number
  /** Light multiply tint for the character poster. */
  characterTint: string
}

export interface MachineIdentity {
  /** "Velvet Turbine" */
  name: string
  /** 100–999 */
  series: number
  /** "Velvet Turbine #417" */
  title: string
  /** "Dense pins · 3 feeders: Mag-Spin, Prism Core, Gauss Cannon" */
  descriptor: string
  traits: MachineTraits
  backbox: MachineBackboxPick
  /** Seed as lowercase hex, as the share link carries it. */
  seedHex: string
}

/**
 * Pin-count thresholds at the quartiles of generated layouts (roughly 40–110
 * pins, median ~66), so about a quarter of machines read sparse or dense.
 */
const SPARSE_BELOW = 56
const DENSE_ABOVE = 77

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const lig = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

export function deriveMachineTraits(layout: TableLayout): MachineTraits {
  const pinCount = layout.pins.length
  const pinDensity: PinDensity = pinCount < SPARSE_BELOW ? 'sparse' : pinCount > DENSE_ABOVE ? 'dense' : 'standard'
  const activeFeeders = FEEDER_KEYS.filter((k) => layout.feedersEnabled[k])
  // Mean bumper displacement from the canonical table (jitter is ±1 per axis).
  let drift = 0
  const n = Math.min(layout.bumpers.length, CANONICAL_BUMPERS.length)
  for (let i = 0; i < n; i++) {
    drift += Math.hypot(layout.bumpers[i].x - CANONICAL_BUMPERS[i].x, layout.bumpers[i].z - CANONICAL_BUMPERS[i].z)
  }
  const bumperSpread: BumperSpread = n > 0 && drift / n > 0.75 ? 'loose' : 'tight'
  return { pinCount, pinDensity, activeFeeders, bumperSpread }
}

function describe(traits: MachineTraits): string {
  const density = traits.pinDensity[0].toUpperCase() + traits.pinDensity.slice(1)
  const feeders = traits.activeFeeders.map((k) => FEEDER_LABELS[k]).join(', ')
  const bumpers = traits.bumperSpread === 'loose' ? 'loose bumpers' : 'tight bumpers'
  return `${density} pins · ${bumpers} · ${traits.activeFeeders.length} feeders: ${feeders}`
}

export function deriveMachineIdentity(layout: TableLayout): MachineIdentity {
  const seed = layout.seed >>> 0
  const rng = createSeededRng((seed ^ NAME_FORK) >>> 0)
  const name = `${rng.pick(ADJECTIVES)} ${rng.pick(NOUNS)}`
  const series = 100 + (seed % 900)
  const hue = rng.int(360)
  const traits = deriveMachineTraits(layout)
  return {
    name,
    series,
    title: `${name} #${series}`,
    descriptor: describe(traits),
    traits,
    backbox: {
      hue,
      primaryHex: hslToHex(hue, 100, 55),
      accentHex: hslToHex((hue + 150) % 360, 100, 60),
      shaderSpeed: Number((0.4 + rng.next() * 0.6).toFixed(2)),
      characterTint: hslToHex(hue, 70, 88),
    },
    seedHex: seed.toString(16),
  }
}
