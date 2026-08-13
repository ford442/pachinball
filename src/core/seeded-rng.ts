/**
 * Seeded PRNG — pure TypeScript kernel module (no Babylon).
 *
 * Mulberry32 for deterministic gameplay RNG. Lives in `src/core/` alongside
 * EventBus so low-level systems can depend on it without reaching into
 * `src/game-elements/`.
 */

export interface SeededRng {
  /** Next float in [0, 1). */
  next(): number
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number
  pick<T>(arr: readonly T[]): T
  /** Independent sub-stream derived from current state + label. */
  fork(label: string): SeededRng
  /** Inclusive integer range [min, max]. */
  nextInt(min: number, max: number): number
  shuffle<T>(arr: readonly T[]): T[]
  /** Current internal state (u32). */
  state(): number
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

function normalizeSeed(seed: number | string): number {
  return typeof seed === 'string' ? hashStringToSeed(seed) : (seed >>> 0)
}

/** Mulberry32 — fast 32-bit seedable PRNG. */
export function createSeededRng(seed: number | string): SeededRng {
  let s = normalizeSeed(seed)

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error(`SeededRng.int: maxExclusive must be a positive integer, got ${maxExclusive}`)
      }
      return Math.floor(next() * maxExclusive)
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) {
        throw new Error('SeededRng.pick: empty array')
      }
      return arr[Math.floor(next() * arr.length)]!
    },
    fork(label: string): SeededRng {
      return createSeededRng(hashStringToSeed(`${s >>> 0}:${label}`))
    },
    nextInt(min: number, max: number): number {
      if (max < min) {
        const tmp = min
        min = max
        max = tmp
      }
      return min + Math.floor(next() * (max - min + 1))
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
// Session SeededRng — explicit seed injection at game/replay start
// ---------------------------------------------------------------------------

/** Dev/test fallback when getSessionRng() is called before initSessionRng(). */
export const DEV_DEFAULT_SESSION_SEED = 0x12345678

let currentSessionSeed: number = 0
let currentSessionRng: SeededRng | null = null
let sessionInitialized = false

/**
 * Initialize or re-initialize the active gameplay session RNG with a seed.
 * If no seed is provided, a fresh u32 seed is generated.
 */
export function initSessionRng(seed?: number): { seed: number; rng: SeededRng } {
  currentSessionSeed = seed !== undefined ? (seed >>> 0) : randomU32Seed()
  currentSessionRng = createSeededRng(currentSessionSeed)
  sessionInitialized = true
  return { seed: currentSessionSeed, rng: currentSessionRng }
}

/** Whether initSessionRng() has been called this session. */
export function isSessionRngInitialized(): boolean {
  return sessionInitialized
}

/**
 * Get the active session SeededRng instance.
 * Falls back to DEV_DEFAULT_SESSION_SEED when not yet initialized (tests/dev).
 */
export function getSessionRng(): SeededRng {
  if (!currentSessionRng) {
    initSessionRng(DEV_DEFAULT_SESSION_SEED)
  }
  return currentSessionRng!
}

/** Get the active session u32 seed. */
export function getSessionSeed(): number {
  if (!currentSessionRng) {
    initSessionRng(DEV_DEFAULT_SESSION_SEED)
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
 * To ensure deterministic physics replays and fair leaderboards:
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
 *
 * Remaining migration targets: docs/determinism-todo.md
 * ============================================================================
 */
