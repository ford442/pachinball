/**
 * The pachinko field's pins as ONE `PinFieldSpec` (#421). Babylon-free, so
 * the lattice (vanilla or a Daily Cascade layout) is unit-testable without a
 * scene; `PachinkoBuilder` stamps visual instances from the same spec.
 */

import { pinFieldOccupancyForPositions, type PinFieldSpec } from '../core/pin-field'
import { KEEP_OUT_BOXES, type PinLattice } from '../game-elements/daily-cascade-layout'
import { COLLISION_GROUP_PRESETS } from '../game-elements/physics'

/** Vanilla lattice; a Daily Cascade layout brings its own row/column count. */
export const VANILLA_LATTICE: PinLattice = { rows: 10, cols: 13 }
export const PIN_Y = 0.4
export const PEG_HEIGHT = 1.5
export const PEG_BASE_RADIUS = 0.12
export const PEG_TOP_RADIUS = 0.06
/** Collider radius: the tapered peg's average. */
export const PEG_COLLIDER_RADIUS = (PEG_BASE_RADIUS + PEG_TOP_RADIUS) / 2
export const PEG_RESTITUTION = 0.65
export const PEG_FRICTION = 0.1

export function pinInKeepOut(x: number, z: number): boolean {
  for (const box of KEEP_OUT_BOXES) {
    if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) return true
  }
  return false
}

/**
 * The field's pins as ONE descriptor (#421): the staggered lattice spanning
 * `width` × `height` from the field's lower-left corner.
 *
 *   vanilla  — every slot, minus `KEEP_OUT_BOXES` (catcher hole, plunger lane,
 *              flipper arcs, drain mouth), which C++ applies itself.
 *   seeded   — the occupancy mask of the slots the layout kept. Its keep-out
 *              safety net runs here, on the generator's double-precision
 *              positions, and C++ gets no keep-outs: a seeded pin can sit
 *              exactly on a keep-out edge in float32 (x = 8.000000000000004
 *              → 8), and the mask must reproduce the layout pin for pin.
 *
 * Null when seeded positions do not sit on the lattice; the caller then
 * places them one by one.
 */
export function pachinkoPinFieldSpec(
  center: { x: number; z: number },
  width: number,
  height: number,
  pinPositions?: readonly { x: number; z: number }[],
  pinLattice?: PinLattice,
): PinFieldSpec | null {
  const seeded = !!pinPositions && pinPositions.length > 0
  if (seeded && !pinLattice) return null
  const lattice = seeded ? pinLattice! : VANILLA_LATTICE
  const spacingX = width / lattice.cols
  const spec: PinFieldSpec = {
    origin: { x: center.x - width / 2, y: PIN_Y, z: center.z - height / 2 },
    rows: lattice.rows,
    cols: lattice.cols,
    spacingX,
    spacingZ: height / lattice.rows,
    rowOffsetX: spacingX / 2,
    radius: PEG_COLLIDER_RADIUS,
    halfHeight: PEG_HEIGHT / 2,
    restitution: PEG_RESTITUTION,
    friction: PEG_FRICTION,
    collisionGroups: COLLISION_GROUP_PRESETS.WALL,
  }
  if (!seeded) {
    return { ...spec, keepOuts: KEEP_OUT_BOXES.map(({ minX, maxX, minZ, maxZ }) => ({ minX, maxX, minZ, maxZ })) }
  }
  // Seeded layouts already respect the keep-outs; filtering again is the
  // safety net that keeps the plunger corridor clear.
  const kept = pinPositions!.filter((p) => !pinInKeepOut(p.x, p.z))
  const occupancy = pinFieldOccupancyForPositions(spec, kept)
  return occupancy ? { ...spec, occupancy } : null
}
