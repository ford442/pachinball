import { MAG_SPIN_TUNABLES, type FeederId, type MagSpinTunables } from './mag-spin'
import { NANO_LOOM_TUNABLES, type NanoLoomTunables } from './nano-loom'
import { PRISM_CORE_TUNABLES, type PrismCoreTunables } from './prism-core'
import { GAUSS_CANNON_TUNABLES, type GaussCannonTunables } from './gauss-cannon'
import { QUANTUM_TUNNEL_TUNABLES, type QuantumTunnelTunables } from './quantum-tunnel'

export type { FeederId, MagSpinTunables } from './mag-spin'
export type { NanoLoomTunables } from './nano-loom'
export type { PrismCoreTunables } from './prism-core'
export type { GaussCannonTunables } from './gauss-cannon'
export type { QuantumTunnelTunables } from './quantum-tunnel'

/** Discriminated union of all feeder tunable blocks. */
export type FeederTunable =
  | MagSpinTunables
  | NanoLoomTunables
  | PrismCoreTunables
  | GaussCannonTunables
  | QuantumTunnelTunables

/**
 * Behavioral tunables for all five table feeders.
 * Single source of truth — GameConfig aliases these for backward compatibility.
 * Algorithmic constants (2π, deg↔rad) stay inline in feeder implementations.
 *
 * Deep-frozen via Object.freeze; each feeder snapshots its slice at construction.
 */
export const FEEDER_TUNABLES = Object.freeze({
  'mag-spin': MAG_SPIN_TUNABLES,
  'nano-loom': NANO_LOOM_TUNABLES,
  'prism-core': PRISM_CORE_TUNABLES,
  'gauss-cannon': GAUSS_CANNON_TUNABLES,
  'quantum-tunnel': QUANTUM_TUNNEL_TUNABLES,
} as const satisfies Record<FeederId, FeederTunable>)

/** @deprecated Use FeederTunable (singular) for the discriminated union type. */
export type FeederTunables = typeof FEEDER_TUNABLES

/**
 * Validates coupled invariants for a single feeder's tunable block.
 * Called at module load for all five feeders — throws on malformed config before the
 * game constructs any feeder instance.
 */
export function validateFeederTunables(t: FeederTunable): void {
  if (t.kind === 'mag-spin') {
    if (t.catchRadius <= 0)
      throw new Error(`mag-spin: catchRadius must be > 0, got ${t.catchRadius}`)
    if (t.releaseForce <= 0)
      throw new Error(`mag-spin: releaseForce must be > 0, got ${t.releaseForce}`)
    if (t.cooldown < t.spinDuration)
      throw new Error(`mag-spin: cooldown (${t.cooldown}) must be >= spinDuration (${t.spinDuration})`)
  } else if (t.kind === 'nano-loom') {
    if (t.intakeRadius <= 0)
      throw new Error(`nano-loom: intakeRadius must be > 0, got ${t.intakeRadius}`)
    if (t.ejectCooldown <= 0)
      throw new Error(`nano-loom: ejectCooldown must be > 0, got ${t.ejectCooldown}`)
    if (t.liftSpeed <= 0)
      throw new Error(`nano-loom: liftSpeed must be > 0, got ${t.liftSpeed}`)
  } else if (t.kind === 'prism-core') {
    if (t.captureRadius <= 0)
      throw new Error(`prism-core: captureRadius must be > 0, got ${t.captureRadius}`)
    if (t.ejectForce <= 0)
      throw new Error(`prism-core: ejectForce must be > 0, got ${t.ejectForce}`)
    if (t.postReleaseCooldown <= 0)
      throw new Error(`prism-core: postReleaseCooldown must be > 0, got ${t.postReleaseCooldown}`)
    if (t.lockCapacity < 1)
      throw new Error(`prism-core: lockCapacity must be >= 1, got ${t.lockCapacity}`)
  } else if (t.kind === 'gauss-cannon') {
    if (t.intakeRadius <= 0)
      throw new Error(`gauss-cannon: intakeRadius must be > 0, got ${t.intakeRadius}`)
    if (t.muzzleVelocity <= 0)
      throw new Error(`gauss-cannon: muzzleVelocity must be > 0, got ${t.muzzleVelocity}`)
    if (t.cooldown < t.aimDuration)
      throw new Error(`gauss-cannon: cooldown (${t.cooldown}) must be >= aimDuration (${t.aimDuration})`)
    if (t.minAngle >= t.maxAngle)
      throw new Error(`gauss-cannon: minAngle (${t.minAngle}) must be < maxAngle (${t.maxAngle})`)
  } else if (t.kind === 'quantum-tunnel') {
    if (t.inputRadius <= 0)
      throw new Error(`quantum-tunnel: inputRadius must be > 0, got ${t.inputRadius}`)
    if (t.ejectImpulse <= 0)
      throw new Error(`quantum-tunnel: ejectImpulse must be > 0, got ${t.ejectImpulse}`)
    if (t.cooldown < t.transportDelay + t.capturePullDuration)
      throw new Error(
        `quantum-tunnel: cooldown (${t.cooldown}) must be >= transportDelay + capturePullDuration ` +
        `(${t.transportDelay} + ${t.capturePullDuration} = ${t.transportDelay + t.capturePullDuration})`
      )
  }
}

// Boot-time invariant check — runs once when this module is first imported.
;(Object.keys(FEEDER_TUNABLES) as FeederId[]).forEach((id) =>
  validateFeederTunables(FEEDER_TUNABLES[id])
)
