/**
 * The weekly machine: one seeded table that differs from vanilla in more than
 * where the pins sit (docs/DAILY_CASCADE.md, docs/ASYNC_CHALLENGES_EPIC.md).
 *
 * A seed picks, through `getLayoutRng('weekly:' + seed)`:
 *   - pin-field density and keep-outs — the lattice size, the seeded dropout
 *     rate and up to three extra rectangles the pins stay out of;
 *   - bumper offsets from the canonical set, inside a tested envelope;
 *   - which of the five existing feeders are armed.
 *
 * The result is a `WeeklyMachineDescriptor`: plain JSON whose shape and
 * envelope are a Valibot schema (`src/schemas/weekly.ts`), validated the way a
 * track definition is (`validateWeeklyMachine`, like `validateTrackDefinition`).
 * An offset outside the envelope is rejected, never clamped; the generator
 * only ever draws offsets that pass. The table builds it through the same
 * `PhysicsApi` calls as any other table — one `PinField` with `dropout` and
 * `keepOuts` (C++ resolves them), the bumpers it always had — so no new
 * collider type, and a client that loads the seed gets the same
 * `staticContentHash()`.
 *
 * Pure TS — no Babylon / Rapier, so it runs in the worker compile graph and in Vitest.
 */

import { getLayoutRng, getSessionSeed, hashStringToSeed, type SeededRng } from '../core/seeded-rng'
import { resolvePinField, type PinFieldSpec, type PinKeepOut } from '../core/pin-field'
import {
  CANONICAL_BUMPERS,
  FEEDER_KEYS,
  KEEP_OUT_BOXES,
  LAYOUT_CONSTANTS,
  runSpawnProbes,
  validateLayout,
  type BumperSpec,
  type FeederKey,
  type TableLayout,
} from './daily-cascade-layout'
import { parseWith, type SchemaIssue } from '../schemas/schema-kit'
import {
  WEEKLY_ENVELOPE,
  WEEKLY_FIELD_BOUNDS,
  WEEKLY_GRID,
  WEEKLY_MACHINE_VERSION,
  WeeklyMachineSchema,
  type WeeklyBumperOffset,
  type WeeklyMachineDescriptor,
} from '../schemas/weekly'

export {
  WEEKLY_ENVELOPE,
  WEEKLY_MACHINE_VERSION,
  WeeklyMachineSchema,
  type WeeklyBumperOffset,
  type WeeklyMachineDescriptor,
  type WeeklyPinFieldDescriptor,
} from '../schemas/weekly'

const GRID = WEEKLY_GRID
const { minX: FIELD_MIN_X, maxX: FIELD_MAX_X, minZ: FIELD_MIN_Z, maxZ: FIELD_MAX_Z } = WEEKLY_FIELD_BOUNDS

export type WeeklyMachineIssue = SchemaIssue

export type WeeklyMachineValidation =
  | { ok: true; descriptor: WeeklyMachineDescriptor; layout: TableLayout }
  | { ok: false; errors: WeeklyMachineIssue[] }

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** The rim-to-rim gaps and table clearances the shape checks cannot see. */
function validateBumpers(bumpers: readonly BumperSpec[], errors: WeeklyMachineIssue[]): void {
  const flipperArcs = KEEP_OUT_BOXES.find((b) => b.label === 'flipperArcs')
  const radius = (b: BumperSpec) => LAYOUT_CONSTANTS.bumperRadiusBase * b.scale
  bumpers.forEach((b, i) => {
    if (flipperArcs && b.z - radius(b) < flipperArcs.maxZ && b.x >= flipperArcs.minX && b.x <= flipperArcs.maxX) {
      errors.push({ path: `bumpers[${i}]`, message: 'overlaps the flipper arcs' })
    }
    for (let j = i + 1; j < bumpers.length; j++) {
      const o = bumpers[j]
      const gap = Math.hypot(b.x - o.x, b.z - o.z) - radius(b) - radius(o)
      if (gap < WEEKLY_ENVELOPE.bumperGap) {
        errors.push({ path: `bumpers[${i}]`, message: `only ${gap.toFixed(2)} clear of bumpers[${j}]` })
      }
    }
  })
}

/**
 * Validate a descriptor the way `validateTrackDefinition` validates a track:
 * shape and envelope first, then the table it resolves to — the same layout
 * constraints Daily Cascade checks (`validateLayout`), the flipper-arc and
 * bumper-gap clearances, a pin-count floor and the disk spawn probes.
 * Out-of-envelope values are errors; nothing is clamped.
 */
export function validateWeeklyMachine(raw: unknown): WeeklyMachineValidation {
  const shape = parseWith(WeeklyMachineSchema, raw)
  if (!shape.ok) return shape

  const descriptor = shape.value
  const layout = resolveWeeklyLayout(descriptor)
  const errors: WeeklyMachineIssue[] = []
  validateBumpers(layout.bumpers, errors)
  for (const reason of validateLayout(layout).reasons) errors.push({ path: 'layout', message: reason })
  if (layout.pins.length < WEEKLY_ENVELOPE.minPins) {
    errors.push({ path: 'pinField', message: `only ${layout.pins.length} pins; needs ${WEEKLY_ENVELOPE.minPins}` })
  }
  const probes = runSpawnProbes(layout)
  if (!probes.ok) {
    errors.push({ path: 'layout', message: `${probes.stuckCount}/${probes.probeCount} spawn probes stuck` })
  }
  return errors.length === 0 ? { ok: true, descriptor, layout } : { ok: false, errors }
}

// ---------------------------------------------------------------------------
// Descriptor → table
// ---------------------------------------------------------------------------

/** The lattice as a spec carrying only what x/z resolution reads; the table builds the full spec (`pachinkoPinFieldSpec`). */
function resolutionSpec(
  field: { rows: number; cols: number; dropout: number; dropoutSeed: number },
  keepOuts: readonly PinKeepOut[],
): PinFieldSpec {
  const { fieldCenter, fieldWidth, fieldHeight } = LAYOUT_CONSTANTS
  const spacingX = fieldWidth / field.cols
  return {
    origin: { x: fieldCenter.x - fieldWidth / 2, y: 0, z: fieldCenter.z - fieldHeight / 2 },
    rows: field.rows,
    cols: field.cols,
    spacingX,
    spacingZ: fieldHeight / field.rows,
    rowOffsetX: spacingX / 2,
    radius: LAYOUT_CONSTANTS.pinRadius,
    halfHeight: 0.5,
    restitution: 0,
    friction: 0,
    keepOuts,
    dropout: field.dropout,
    dropoutSeed: field.dropoutSeed,
  }
}

/** Square keep-out around a bumper wide enough that no pin touches it (superset of the Daily Cascade circle). */
function bumperClearance(b: BumperSpec): PinKeepOut {
  const half = LAYOUT_CONSTANTS.bumperRadiusBase * b.scale + LAYOUT_CONSTANTS.pinRadius + LAYOUT_CONSTANTS.bumperPinMargin
  return { minX: b.x - half, maxX: b.x + half, minZ: b.z - half, maxZ: b.z + half }
}

/** Canonical bumpers moved by the descriptor's offsets. */
export function weeklyBumpers(descriptor: WeeklyMachineDescriptor): BumperSpec[] {
  return CANONICAL_BUMPERS.map((b, i) => {
    const offset = descriptor.bumpers[i] ?? { dx: 0, dz: 0 }
    return { ...b, x: b.x + offset.dx, z: b.z + offset.dz }
  })
}

/**
 * The table a descriptor describes: bumpers, armed feeders and a pin field
 * whose keep-outs are the table's own, the descriptor's and one around each
 * bumper. `pins` is that field resolved (float32-exact, as C++ resolves it),
 * so the constraint checks look at the pins that will collide.
 */
export function resolveWeeklyLayout(descriptor: WeeklyMachineDescriptor): TableLayout {
  const bumpers = weeklyBumpers(descriptor)
  const keepOuts: PinKeepOut[] = [
    ...KEEP_OUT_BOXES.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ })),
    ...descriptor.pinField.keepOuts,
    ...bumpers.map(bumperClearance),
  ]
  const { rows, cols, dropout, dropoutSeed } = descriptor.pinField
  const pins = resolvePinField(resolutionSpec(descriptor.pinField, keepOuts)).map((p) => ({
    x: p.position.x,
    z: p.position.z,
  }))
  return {
    seed: descriptor.seed,
    seedId: `weekly-${descriptor.seed.toString(16)}`,
    pins,
    pinLattice: { rows, cols },
    pinField: { rows, cols, dropout, dropoutSeed, keepOuts },
    bumpers,
    feedersEnabled: { ...descriptor.feeders },
  }
}

/** Stable fingerprint of a descriptor (FNV-1a of its JSON), for logs and the debug HUD. */
export function weeklyMachineHash(descriptor: WeeklyMachineDescriptor): string {
  return hashStringToSeed(JSON.stringify(descriptor)).toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Draw attempts before the generator falls back to the plain machine. */
const MAX_ATTEMPTS = 48

const unit = (rng: SeededRng, min: number, max: number): number => rng.nextInt(min * GRID, max * GRID) / GRID

function drawKeepOuts(rng: SeededRng): PinKeepOut[] {
  const { keepOuts } = WEEKLY_ENVELOPE
  const count = rng.nextInt(0, keepOuts.maxCount)
  const out: PinKeepOut[] = []
  for (let i = 0; i < count; i++) {
    const width = unit(rng, keepOuts.minWidth, keepOuts.maxWidth)
    const height = unit(rng, keepOuts.minHeight, keepOuts.maxHeight)
    const minX = unit(rng, FIELD_MIN_X, FIELD_MAX_X - width)
    const minZ = unit(rng, FIELD_MIN_Z, FIELD_MAX_Z - height)
    out.push({ minX, maxX: minX + width, minZ, maxZ: minZ + height })
  }
  return out
}

function drawFeeders(rng: SeededRng): Record<FeederKey, boolean> {
  const armed = rng.nextInt(WEEKLY_ENVELOPE.armedFeeders.min, WEEKLY_ENVELOPE.armedFeeders.max)
  const order = rng.shuffle(FEEDER_KEYS)
  const feeders = {} as Record<FeederKey, boolean>
  for (const key of FEEDER_KEYS) feeders[key] = false
  for (let i = 0; i < armed; i++) feeders[order[i]] = true
  return feeders
}

/**
 * One offset per bumper, drawn until it fits: inside the playfield, off the
 * flipper arcs and clear of the bumpers already placed. A bumper that finds no
 * spot stays on its canonical one (which fits by construction).
 */
function drawBumperOffsets(rng: SeededRng): WeeklyBumperOffset[] {
  const max = WEEKLY_ENVELOPE.bumperOffsetMax
  const placed: BumperSpec[] = []
  const offsets: WeeklyBumperOffset[] = []
  CANONICAL_BUMPERS.forEach((canonical, i) => {
    let chosen: WeeklyBumperOffset = { dx: 0, dz: 0 }
    for (let tries = 0; tries < 8; tries++) {
      const dx = unit(rng, -max, max)
      const dz = unit(rng, -max, max)
      const candidate: BumperSpec = { ...canonical, x: canonical.x + dx, z: canonical.z + dz }
      // Later bumpers are still canonical, so a candidate also has to clear them.
      const others = [...placed, ...CANONICAL_BUMPERS.slice(i + 1)]
      const errors: WeeklyMachineIssue[] = []
      validateBumpers([candidate, ...others], errors)
      if (errors.some((e) => e.path === 'bumpers[0]')) continue
      if (!bumperInPlayfield(candidate)) continue
      chosen = { dx, dz }
      break
    }
    placed.push({ ...canonical, x: canonical.x + chosen.dx, z: canonical.z + chosen.dz })
    offsets.push(chosen)
  })
  return offsets
}

function bumperInPlayfield(b: BumperSpec): boolean {
  const { playfieldMinX, playfieldMaxX, playfieldMinZ, playfieldMaxZ } = LAYOUT_CONSTANTS
  if (b.x < playfieldMinX + 1 || b.x > playfieldMaxX - 1 || b.z < playfieldMinZ + 0.5 || b.z > playfieldMaxZ - 0.5) {
    return false
  }
  return !KEEP_OUT_BOXES.some(
    (box) => (box.label === 'launchLane' || box.label === 'drainMouth') && b.x >= box.minX && b.x <= box.maxX && b.z >= box.minZ && b.z <= box.maxZ,
  )
}

/** One candidate descriptor from the stream: every field drawn on the 1/64 grid, inside the envelope. */
function drawCandidate(seed: number, rng: SeededRng): WeeklyMachineDescriptor {
  const { rows, cols, dropout } = WEEKLY_ENVELOPE
  return {
    schemaVersion: WEEKLY_MACHINE_VERSION,
    seed,
    pinField: {
      rows: rng.nextInt(rows.min, rows.max),
      cols: rng.nextInt(cols.min, cols.max),
      dropout: rng.nextInt(dropout.min * GRID, dropout.max * GRID) / GRID,
      dropoutSeed: Math.floor(rng.next() * 0x1_0000_0000) >>> 0,
      keepOuts: drawKeepOuts(rng),
    },
    bumpers: drawBumperOffsets(rng),
    feeders: drawFeeders(rng),
  }
}

/** The always-valid machine for a seed: vanilla geometry and lightest dropout, three feeders armed in a seed-chosen rotation. */
export function plainWeeklyMachine(seed: number): WeeklyMachineDescriptor {
  const start = (seed >>> 0) % FEEDER_KEYS.length
  const feeders = {} as Record<FeederKey, boolean>
  FEEDER_KEYS.forEach((key, i) => {
    feeders[key] = (i - start + FEEDER_KEYS.length) % FEEDER_KEYS.length < 3
  })
  return {
    schemaVersion: WEEKLY_MACHINE_VERSION,
    seed: seed >>> 0,
    pinField: { rows: 10, cols: 13, dropout: WEEKLY_ENVELOPE.dropout.min, dropoutSeed: hashStringToSeed(`plain:${seed >>> 0}`), keepOuts: [] },
    bumpers: CANONICAL_BUMPERS.map(() => ({ dx: 0, dz: 0 })),
    feeders,
  }
}

/**
 * `getLayoutRng('weekly:' + seed)`. Layout streams are keyed by the *session*
 * seed as well, so the machine is a function of `seed` alone only while the
 * session RNG was seeded with that same seed (`startGame` does, before it
 * builds the table); anything else is a caller bug, not a different machine.
 */
export function weeklyMachineRng(seed: number): SeededRng {
  const wanted = seed >>> 0
  if (getSessionSeed() !== wanted) {
    throw new Error(
      `weekly machine ${wanted}: the session RNG is seeded with ${getSessionSeed()}; call initSessionRng(${wanted}) first`,
    )
  }
  return getLayoutRng(`weekly:${wanted}`)
}

/**
 * The machine for `seed`: draws candidates from `weeklyMachineRng(seed)` until
 * one validates, then falls back to `plainWeeklyMachine`. Same seed, same
 * descriptor — on this client, on a spectator's and in a CI run.
 */
export function generateWeeklyMachine(
  seed: number,
  rng: SeededRng = weeklyMachineRng(seed),
): WeeklyMachineDescriptor {
  const wanted = seed >>> 0
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = drawCandidate(wanted, rng)
    if (validateWeeklyMachine(candidate).ok) return candidate
  }
  return plainWeeklyMachine(wanted)
}

/** `generateWeeklyMachine` plus the table it resolves to. */
export function generateWeeklyLayout(
  seed: number,
  rng?: SeededRng,
): { descriptor: WeeklyMachineDescriptor; layout: TableLayout } {
  const descriptor = generateWeeklyMachine(seed, rng)
  return { descriptor, layout: resolveWeeklyLayout(descriptor) }
}
