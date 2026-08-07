/**
 * Seeded PRNG — pure TypeScript, no Babylon.
 * Mulberry32 for layout determinism (Daily Cascade / free-play).
 */

export interface SeededRng {
  /** Next float in [0, 1) */
  next(): number
  /** Inclusive integer range */
  nextInt(min: number, max: number): number
  pick<T>(arr: readonly T[]): T
  shuffle<T>(arr: readonly T[]): T[]
  /** Current internal state (u32) */
  state(): number
}

/** Mulberry32 — fast 32-bit seedable PRNG. */
export function createSeededRng(seed: number): SeededRng {
  let s = seed >>> 0

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    nextInt(min: number, max: number): number {
      if (max < min) {
        const tmp = min
        min = max
        max = tmp
      }
      return min + Math.floor(next() * (max - min + 1))
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) {
        throw new Error('SeededRng.pick: empty array')
      }
      return arr[Math.floor(next() * arr.length)]!
    },
    shuffle<T>(arr: readonly T[]): T[] {
      const out = arr.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = out[i]!
        out[i] = out[j]!
        out[j] = tmp
      }
      return out
    },
    state(): number {
      return s >>> 0
    },
  }
}

/** FNV-1a 32-bit hash of a string → u32 seed. */
export function hashStringToSeed(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** UTC calendar day id `YYYY-MM-DD`. */
export function dailySeedId(date: Date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function seedFromDailyId(id: string): number {
  return hashStringToSeed(id)
}

/** Fresh free-play u32 seed. */
export function randomU32Seed(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0]! >>> 0
  }
  return (Date.now() ^ (Math.floor(Math.random() * 0xffffffff) >>> 0)) >>> 0
}

// ---------------------------------------------------------------------------
// Session SeededRng Management
// ---------------------------------------------------------------------------

let currentSessionSeed: number = 0
let currentSessionRng: SeededRng | null = null

/**
 * Initialize or re-initialize the active gameplay session RNG with a seed.
 * If no seed is provided, a fresh u32 seed is generated.
 */
export function initSessionRng(seed?: number): { seed: number; rng: SeededRng } {
  currentSessionSeed = seed !== undefined ? (seed >>> 0) : randomU32Seed()
  currentSessionRng = createSeededRng(currentSessionSeed)
  return { seed: currentSessionSeed, rng: currentSessionRng }
}

/**
 * Get the active session SeededRng instance.
 * Automatically initializes with a default seed if not explicitly initialized.
 */
export function getSessionRng(): SeededRng {
  if (!currentSessionRng) {
    initSessionRng(0x12345678)
  }
  return currentSessionRng!
}

/**
 * Get the active session u32 seed.
 */
export function getSessionSeed(): number {
  if (!currentSessionRng) {
    initSessionRng(0x12345678)
  }
  return currentSessionSeed
}

/** Reset active session RNG with optional new seed. */
export function resetSessionRng(seed?: number): void {
  initSessionRng(seed)
}

/**
 * ============================================================================
 * GAMEPLAY VS COSMETIC RNG POLICY
 * ============================================================================
 *
 * To ensure 100% deterministic physics replays and fair leaderboards:
 *
 * MUST USE SeededRng (getSessionRng()):
 * - Ball spawn type weights and initial spawn position/velocity jitter
 * - Multiball spawn offsets and gold ball swarm trajectories
 * - Imposter ball catch release impulses
 * - Feeder release angle and spin variances (mag-spin, quantum-tunnel, nano-loom, etc.)
 * - Dynamic launcher and trap boost impulse variances
 * - Spinner bumper target rotation direction
 * - Slot machine activation checks and reel outcome generation
 *
 * EXEMPT (Cosmetic RNG, may use Math.random()):
 * - Audio synth frequencies, beep pitches, and noise buffer generation
 * - Particle shard initial velocities, scales, and rotation speeds
 * - Camera shake / screen shake pixel offsets
 * - Decorative trim mesh placement, LED jitter, and cabinet detail scaling
 * - Backbox LCD overlay walk-by emoji timers and visual walk speeds
 * - Ball stack visual rotation offsets
 * ============================================================================
 */

