export interface GaussCannonTunables {
  readonly kind: 'gauss-cannon'
  /** Intake capture trigger radius in world units. */
  readonly intakeRadius: number
  /** Scalar impulse applied to the ball on FIRE. */
  readonly muzzleVelocity: number
  /** Duration of the AIM sweep phase in seconds. */
  readonly aimDuration: number
  /** Post-FIRE ignore window in seconds. Invariant: >= aimDuration. */
  readonly cooldown: number
  readonly minAngle: number
  readonly maxAngle: number
  readonly sweepSpeed: number
  readonly loadLerpSpeed: number
  readonly loadArrivalDistance: number
  readonly breechYOffset: number
  readonly idleSweepRate: number
  readonly aimSweepMultiplier: number
  readonly gaussPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly animation: {
    readonly coilPulseRate: number
    readonly coilStretchAmplitude: number
    readonly recoilSpringStrength: number
    readonly recoilDamping: number
    readonly fireRecoilImpulse: number
    readonly aimVibrationIntensity: number
    readonly fireVibrationIntensity: number
    readonly vibrationDecay: number
    readonly idleSweepScale: number
    readonly stateLightLoad: number
    readonly stateLightAim: number
    readonly stateLightCooldown: number
    readonly fireLightFlashIntensity: number
    readonly fireLightFadeIntensity: number
  }
}

export const GAUSS_CANNON_TUNABLES = Object.freeze({
  kind: 'gauss-cannon',
  gaussPosition: Object.freeze({ x: -12.0, y: 0.5, z: -8.0 }),
  intakeRadius: 1.0,
  muzzleVelocity: 30.0,
  minAngle: 30,
  maxAngle: 60,
  sweepSpeed: 1.0,
  cooldown: 2.0,
  aimDuration: 2.0,
  loadLerpSpeed: 5,
  loadArrivalDistance: 0.2,
  breechYOffset: 1.0,
  idleSweepRate: 2.0,
  aimSweepMultiplier: 20,
  animation: Object.freeze({
    coilPulseRate: 10,
    coilStretchAmplitude: 0.15,
    recoilSpringStrength: 20.0,
    recoilDamping: 0.7,
    fireRecoilImpulse: 0.5,
    aimVibrationIntensity: 0.02,
    fireVibrationIntensity: 0.3,
    vibrationDecay: 0.95,
    idleSweepScale: 10,
    stateLightLoad: 0.5,
    stateLightAim: 1.0,
    stateLightCooldown: 0.2,
    fireLightFlashIntensity: 5.0,
    fireLightFadeIntensity: 0.2,
  }),
} as const satisfies GaussCannonTunables)
