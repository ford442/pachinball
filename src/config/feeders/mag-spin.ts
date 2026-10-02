/** Identifies which feeder a tunable block belongs to. */
export type FeederId = 'mag-spin' | 'nano-loom' | 'prism-core' | 'gauss-cannon' | 'quantum-tunnel'

export interface MagSpinTunables {
  readonly kind: 'mag-spin'
  /** Capture trigger radius in world units. */
  readonly catchRadius: number
  /**
   * Radius of the C++ pull well that draws idle-state balls toward the feeder
   * (owner modes only). Keep `feederPosition.x + pullRadius` clear of the plunger
   * lane (`checkProximity` skips `x > 8.5`).
   */
  readonly pullRadius: number
  /** Half-height of the pulled band around `feederPosition.y`. */
  readonly pullHalfHeight: number
  /**
   * Pull at the well's axis in m/s², fading linearly to zero at `pullRadius`.
   * Measured on the owner table (slope z = -5, ground friction 0.18, the standard ball):
   * a resting ball is captured out to 1.4 m with no pull, and out to 1.7 / 1.9 / 2.2 /
   * 2.4 / 2.7 m at 6 / 10 / 15 / 20 / 30 m/s². A ball rolling past gains 0.1-0.5 m of
   * funnel half-width. A play-feel knob: raise it for a stronger tractor beam.
   */
  readonly pullAcceleration: number
  /** Duration of the SPIN phase in seconds. */
  readonly spinDuration: number
  /** Post-RELEASE ignore window in seconds. Invariant: >= spinDuration. */
  readonly cooldown: number
  /** Scalar impulse applied to the ball on RELEASE. */
  readonly releaseForce: number
  readonly releaseAngleVariance: number
  readonly releaseTarget: { readonly x: number; readonly y: number; readonly z: number }
  readonly catchLerpSpeed: number
  readonly catchArrivalDistance: number
  readonly holdYOffset: number
  readonly maxCaptureHeightY: number
  readonly spinAngularSpeed: number
  readonly releaseUpwardBias: number
  readonly feederPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly animation: {
    readonly ringSpeedSpin: number
    readonly ringSpeedIdle: number
    readonly ringSpeedDefault: number
    readonly ringLerpSpin: number
    readonly ringLerpDefault: number
    readonly shakeDecay: number
    readonly idlePulseFrequency: number
    readonly idleLightBase: number
    readonly idleLightPulseAmplitude: number
    readonly idleEmissiveBase: number
    readonly idleEmissivePulseAmplitude: number
    readonly spinChargeLightBase: number
    readonly spinChargeLightScale: number
    readonly releaseShakeInitial: number
    readonly stateLightIdle: number
    readonly stateLightCatch: number
    readonly stateLightSpin: number
    readonly stateLightCooldown: number
  }
  readonly physicsExtras: {
    readonly releaseSpinVarianceXZ: number
    readonly releaseSpinBaseY: number
    readonly spinAxisMultiplierY: number
    readonly spinAxisMultiplierZ: number
  }
}

export const MAG_SPIN_TUNABLES = Object.freeze({
  kind: 'mag-spin',
  // Upper-left of center — well clear of the plunger corridor (x≈10.5)
  feederPosition: Object.freeze({ x: 4.5, y: 0.5, z: 15 }),
  catchRadius: 1.5,
  pullRadius: 3.0,
  pullHalfHeight: 1.0,
  pullAcceleration: 10,
  spinDuration: 1.2,
  cooldown: 3.0,
  releaseForce: 25.0,
  releaseAngleVariance: 0.25,
  /** Launch direction target — center playfield bumpers */
  releaseTarget: Object.freeze({ x: 0, y: 0, z: 5 }),
  catchLerpSpeed: 6,
  catchArrivalDistance: 0.15,
  holdYOffset: 0.5,
  maxCaptureHeightY: 2.0,
  spinAngularSpeed: 32,
  releaseUpwardBias: 0.08,
  animation: Object.freeze({
    ringSpeedSpin: 24,
    ringSpeedIdle: 1,
    ringSpeedDefault: 4,
    ringLerpSpin: 2.5,
    ringLerpDefault: 0.5,
    shakeDecay: 0.88,
    idlePulseFrequency: 1.8,
    idleLightBase: 0.35,
    idleLightPulseAmplitude: 0.35,
    idleEmissiveBase: 0.6,
    idleEmissivePulseAmplitude: 0.4,
    spinChargeLightBase: 1.2,
    spinChargeLightScale: 1.5,
    releaseShakeInitial: 0.6,
    stateLightIdle: 0.5,
    stateLightCatch: 1.0,
    stateLightSpin: 1.5,
    stateLightCooldown: 0.2,
  }),
  physicsExtras: Object.freeze({
    releaseSpinVarianceXZ: 8,
    releaseSpinBaseY: 12,
    spinAxisMultiplierY: 1.3,
    spinAxisMultiplierZ: 0.7,
  }),
} as const satisfies MagSpinTunables)
