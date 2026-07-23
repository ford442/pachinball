/**
 * Daily Cascade table layout generator + constraint validation.
 * Pure TS — no Babylon / Rapier. Used at runtime and in Vitest spawn probes.
 */

import { createSeededRng, type SeededRng } from './seeded-rng'

export type FeederKey =
  | 'magSpin'
  | 'nanoLoom'
  | 'prismCore'
  | 'gaussCannon'
  | 'quantumTunnel'

export const FEEDER_KEYS: readonly FeederKey[] = [
  'magSpin',
  'nanoLoom',
  'prismCore',
  'gaussCannon',
  'quantumTunnel',
] as const

export interface PinSpec {
  x: number
  z: number
}

export interface BumperSpec {
  x: number
  z: number
  color: string
  scale: number
}

export interface TableLayout {
  seed: number
  seedId: string
  pins: PinSpec[]
  bumpers: BumperSpec[]
  feedersEnabled: Record<FeederKey, boolean>
}

/** Canonical bumper set from the default table (pre-jitter). */
export const CANONICAL_BUMPERS: readonly BumperSpec[] = [
  { x: 0, z: 8, color: '#ff00aa', scale: 1.2 },
  { x: -4, z: 4, color: '#00aaff', scale: 1.0 },
  { x: 4, z: 4, color: '#00aaff', scale: 1.0 },
  { x: -3, z: 0, color: '#ffaa00', scale: 0.9 },
  { x: 3, z: 0, color: '#ffaa00', scale: 0.9 },
  { x: 0, z: 14, color: '#00ff88', scale: 0.85 },
  { x: -6, z: 10, color: '#ff4400', scale: 1.0 },
  { x: 0, z: 2, color: '#88ffaa', scale: 0.85 },
  { x: -5, z: 6, color: '#ffaa88', scale: 0.9 },
  { x: 5, z: 6, color: '#ffaa88', scale: 0.9 },
  { x: -4, z: -1, color: '#aaffff', scale: 0.8 },
  { x: 4, z: -1, color: '#aaffff', scale: 0.8 },
]

export const LAYOUT_CONSTANTS = {
  pinRadius: 0.12,
  pinMinGap: 0.35,
  bumperRadiusBase: 0.4,
  bumperPinMargin: 0.25,
  fieldCenter: { x: 0, z: 6 },
  fieldWidth: 24,
  fieldHeight: 22,
  catcherHalf: 2.5,
  playfieldMinX: -11,
  playfieldMaxX: 11,
  playfieldMinZ: -2,
  playfieldMaxZ: 16,
  drainZ: -12,
  ballRadius: 0.35,
} as const

/** Keep-out AABBs (xz plane): flipper arcs, launch lane, drain, catcher. */
export interface KeepOutBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  label: string
}

export const KEEP_OUT_BOXES: readonly KeepOutBox[] = [
  // Flipper arcs / lower funnel
  { minX: -8, maxX: 8, minZ: -6, maxZ: -1.5, label: 'flipperArcs' },
  // Launch / plunger corridor (right)
  { minX: 8.5, maxX: 12, minZ: -12, maxZ: 18, label: 'launchLane' },
  // Drain mouth
  { minX: -6, maxX: 6, minZ: -16, maxZ: -11, label: 'drainMouth' },
  // Center catcher hole (pins skipped here)
  { minX: -2.5, maxX: 2.5, minZ: 3.5, maxZ: 8.5, label: 'catcher' },
]

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

function inBox(x: number, z: number, box: KeepOutBox): boolean {
  return x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ
}

function bumperRadius(scale: number): number {
  return LAYOUT_CONSTANTS.bumperRadiusBase * scale
}

export function validateLayout(layout: TableLayout): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const { pinRadius, pinMinGap, bumperPinMargin } = LAYOUT_CONSTANTS
  const minPinPin = 2 * pinRadius + pinMinGap

  for (let i = 0; i < layout.pins.length; i++) {
    const a = layout.pins[i]!
    for (const box of KEEP_OUT_BOXES) {
      if (box.label === 'catcher') continue // catcher hole is intentional skip, not a hard fail for leftover pins
      if (inBox(a.x, a.z, box)) {
        reasons.push(`pin(${a.x.toFixed(2)},${a.z.toFixed(2)}) in ${box.label}`)
      }
    }
    for (let j = i + 1; j < layout.pins.length; j++) {
      const b = layout.pins[j]!
      if (dist2(a.x, a.z, b.x, b.z) < minPinPin * minPinPin) {
        reasons.push(`pin-pin too close at (${a.x.toFixed(1)},${a.z.toFixed(1)})`)
        break
      }
    }
  }

  for (const bumper of layout.bumpers) {
    const br = bumperRadius(bumper.scale)
    if (
      bumper.x < LAYOUT_CONSTANTS.playfieldMinX ||
      bumper.x > LAYOUT_CONSTANTS.playfieldMaxX ||
      bumper.z < LAYOUT_CONSTANTS.playfieldMinZ ||
      bumper.z > LAYOUT_CONSTANTS.playfieldMaxZ
    ) {
      reasons.push(`bumper OOB (${bumper.x},${bumper.z})`)
    }
    // Keep bumpers out of launch lane and drain
    for (const box of KEEP_OUT_BOXES) {
      if (box.label === 'catcher' || box.label === 'flipperArcs') continue
      if (inBox(bumper.x, bumper.z, box)) {
        reasons.push(`bumper in ${box.label}`)
      }
    }
    for (const pin of layout.pins) {
      const minD = br + pinRadius + bumperPinMargin
      if (dist2(bumper.x, bumper.z, pin.x, pin.z) < minD * minD) {
        reasons.push(`pin inside bumper at (${bumper.x},${bumper.z})`)
        break
      }
    }
  }

  const enabledCount = FEEDER_KEYS.filter((k) => layout.feedersEnabled[k]).length
  if (enabledCount < 2 || enabledCount > 4) {
    reasons.push(`feeder enable count ${enabledCount} not in [2,4]`)
  }

  return { ok: reasons.length === 0, reasons }
}

function generatePins(rng: SeededRng, dropoutRate: number): PinSpec[] {
  const { fieldCenter, fieldWidth, fieldHeight, catcherHalf } = LAYOUT_CONSTANTS
  const rows = rng.nextInt(8, 12)
  const cols = rng.nextInt(11, 15)
  const spacingX = fieldWidth / cols
  const spacingZ = fieldHeight / rows
  const pins: PinSpec[] = []

  for (let r = 0; r < rows; r++) {
    const offsetX = r % 2 === 0 ? 0 : spacingX / 2
    for (let c = 0; c < cols; c++) {
      const x = fieldCenter.x - fieldWidth / 2 + c * spacingX + offsetX
      const z = fieldCenter.z - fieldHeight / 2 + r * spacingZ
      if (Math.abs(x) < catcherHalf && Math.abs(z - fieldCenter.z) < catcherHalf) continue
      // Keep-outs (except catcher already handled)
      let blocked = false
      for (const box of KEEP_OUT_BOXES) {
        if (box.label === 'catcher') continue
        if (inBox(x, z, box)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      if (rng.next() < dropoutRate) continue
      pins.push({ x, z })
    }
  }
  return pins
}

function generateBumpers(rng: SeededRng): BumperSpec[] {
  const jitter = 1.0
  return CANONICAL_BUMPERS.map((b) => {
    let x = b.x + (rng.next() * 2 - 1) * jitter
    let z = b.z + (rng.next() * 2 - 1) * jitter
    x = Math.max(LAYOUT_CONSTANTS.playfieldMinX + 1, Math.min(LAYOUT_CONSTANTS.playfieldMaxX - 1, x))
    z = Math.max(LAYOUT_CONSTANTS.playfieldMinZ + 0.5, Math.min(LAYOUT_CONSTANTS.playfieldMaxZ - 0.5, z))
    for (const box of KEEP_OUT_BOXES) {
      if (box.label !== 'launchLane' && box.label !== 'drainMouth') continue
      if (inBox(x, z, box)) {
        x = b.x
        z = b.z
      }
    }
    return { x, z, color: b.color, scale: b.scale }
  })
}

function generateFeeders(rng: SeededRng): Record<FeederKey, boolean> {
  const enableCount = rng.nextInt(2, 4)
  const order = rng.shuffle([...FEEDER_KEYS])
  const enabled = {} as Record<FeederKey, boolean>
  for (const k of FEEDER_KEYS) enabled[k] = false
  for (let i = 0; i < enableCount; i++) {
    enabled[order[i]!] = true
  }
  return enabled
}

export interface GenerateLayoutOptions {
  seed: number
  seedId: string
  maxAttempts?: number
}

/**
 * Deterministic layout for a seed. Retries with progressive dropout relaxation.
 * Pins that fall inside bumper clearance are culled after bumper placement.
 * Final candidates must pass disk spawn probes (CI acceptance).
 */
export function generateTableLayout(options: GenerateLayoutOptions): TableLayout {
  const maxAttempts = options.maxAttempts ?? 48
  let last: TableLayout | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createSeededRng((options.seed + attempt * 0x9e3779b9) >>> 0)
    const dropout = Math.min(0.45, 0.12 + attempt * 0.008)
    const bumpers = generateBumpers(rng)
    let pins = generatePins(rng, dropout)
    pins = carveVerticalCorridors(pins, rng)
    pins = cullPinsNearBumpers(pins, bumpers)
    const layout: TableLayout = {
      seed: options.seed,
      seedId: options.seedId,
      pins,
      bumpers,
      feedersEnabled: generateFeeders(rng),
    }
    last = layout
    const v = validateLayout(layout)
    if (!v.ok) continue
    if (runSpawnProbes(layout).ok) return layout
  }

  if (last) {
    last = {
      ...last,
      pins: cullPinsNearBumpers(
        carveVerticalCorridors(last.pins, createSeededRng(options.seed ^ 0xabcddcba)),
        last.bumpers,
        LAYOUT_CONSTANTS.bumperPinMargin + 0.4,
      ),
    }
  }
  return last!
}

/** Remove pins near a few vertical gutters so balls can fall through. */
function carveVerticalCorridors(pins: PinSpec[], rng: SeededRng): PinSpec[] {
  const gutters = [
    rng.next() * 6 - 3,
    rng.next() * 8 - 4,
    0,
  ]
  const half = 0.55
  return pins.filter((p) => {
    for (const g of gutters) {
      if (Math.abs(p.x - g) < half) return false
    }
    return true
  })
}

function cullPinsNearBumpers(
  pins: PinSpec[],
  bumpers: BumperSpec[],
  extraMargin = 0,
): PinSpec[] {
  const { pinRadius, bumperPinMargin } = LAYOUT_CONSTANTS
  return pins.filter((pin) => {
    for (const bumper of bumpers) {
      const minD = bumperRadius(bumper.scale) + pinRadius + bumperPinMargin + extraMargin
      if (dist2(pin.x, pin.z, bumper.x, bumper.z) < minD * minD) return false
    }
    return true
  })
}

// ---------------------------------------------------------------------------
// Spawn probes (disk drop simulation for CI)
// ---------------------------------------------------------------------------

export interface SpawnProbeResult {
  seed: number
  stuckCount: number
  probeCount: number
  ok: boolean
}

/**
 * Drop a disk from top-column X positions; step down colliding with pin/bumper circles.
 * Stuck = no Z progress for many steps while overlapping obstacles.
 * Allows lateral slide along contacts (pinball-like).
 */
export function runSpawnProbes(layout: TableLayout, options?: { columns?: number }): SpawnProbeResult {
  const columns = options?.columns ?? 12
  const { ballRadius, fieldWidth, fieldCenter, drainZ } = LAYOUT_CONSTANTS
  const topZ = fieldCenter.z + fieldHeightHalf()
  const step = ballRadius * 0.55
  let stuckCount = 0

  const obstacles: { x: number; z: number; r: number }[] = [
    ...layout.pins.map((p) => ({ x: p.x, z: p.z, r: LAYOUT_CONSTANTS.pinRadius + ballRadius * 0.85 })),
    ...layout.bumpers.map((b) => ({
      x: b.x,
      z: b.z,
      r: bumperRadius(b.scale) + ballRadius * 0.85,
    })),
  ]

  for (let c = 0; c < columns; c++) {
    let x = fieldCenter.x - fieldWidth / 2 + (c + 0.5) * (fieldWidth / columns)
    let z = topZ
    let stalled = 0
    let stuck = false
    let bestZ = z

    for (let iter = 0; iter < 500; iter++) {
      if (z <= drainZ) break
      const candidates = [
        { x, z: z - step },
        { x: x - step * 0.8, z: z - step * 0.9 },
        { x: x + step * 0.8, z: z - step * 0.9 },
        { x: x - step * 1.2, z: z - step * 0.55 },
        { x: x + step * 1.2, z: z - step * 0.55 },
        { x: x - step * 1.6, z: z - step * 0.35 },
        { x: x + step * 1.6, z: z - step * 0.35 },
      ]
      let moved = false
      for (const next of candidates) {
        if (next.x < LAYOUT_CONSTANTS.playfieldMinX || next.x > LAYOUT_CONSTANTS.playfieldMaxX) continue
        if (collides(next.x, next.z, obstacles)) continue
        x = next.x
        z = next.z
        moved = true
        if (z < bestZ - 0.01) {
          bestZ = z
          stalled = 0
        } else {
          stalled++
        }
        break
      }
      if (!moved) {
        stalled++
        x += ((c + iter) % 2 === 0 ? 1 : -1) * step * 0.2
      }
      if (stalled > 28) {
        stuck = true
        break
      }
    }

    if (stuck || z > drainZ + 2) stuckCount++
  }

  return {
    seed: layout.seed,
    stuckCount,
    probeCount: columns,
    ok: stuckCount < 2,
  }
}

function fieldHeightHalf(): number {
  return LAYOUT_CONSTANTS.fieldHeight / 2
}

function collides(
  x: number,
  z: number,
  obstacles: { x: number; z: number; r: number }[],
): boolean {
  for (const o of obstacles) {
    if (dist2(x, z, o.x, o.z) < o.r * o.r) return true
  }
  return false
}
