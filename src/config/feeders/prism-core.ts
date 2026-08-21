export interface PrismCoreTunables {
  readonly kind: 'prism-core'
  /** Ball-lock sensor radius in world units. */
  readonly captureRadius: number
  /** Scalar impulse applied to each ball on OVERLOAD eject. */
  readonly ejectForce: number
  /** Spread angle of the multiball cone in degrees. */
  readonly ejectSpread: number
  /** Maximum balls held before OVERLOAD. */
  readonly lockCapacity: number
  /** Post-OVERLOAD ignore window in seconds. */
  readonly postReleaseCooldown: number
  readonly prismPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly animation: {
    readonly rotationSpeedIdle: number
    readonly rotationSpeedLocked1: number
    readonly rotationSpeedLocked2: number
    readonly rotationSpeedOverload: number
    readonly rotationLerpRate: number
    readonly outerRotationRatio: number
    readonly breathPhaseMultiplier: number
    readonly breathAmplitudeBase: number
    readonly bloomDecay: number
    readonly bloomScaleMultiplier: number
    readonly bloomAlphaScale: number
    readonly bloomCutoff: number
  }
}

export const PRISM_CORE_TUNABLES = Object.freeze({
  kind: 'prism-core',
  prismPosition: Object.freeze({ x: 0.0, y: 0.5, z: 12.0 }),
  captureRadius: 1.2,
  ejectForce: 20.0,
  ejectSpread: 45,
  lockCapacity: 3,
  postReleaseCooldown: 2.0,
  animation: Object.freeze({
    rotationSpeedIdle: 0.5,
    rotationSpeedLocked1: 2.0,
    rotationSpeedLocked2: 5.0,
    rotationSpeedOverload: 15.0,
    rotationLerpRate: 2,
    outerRotationRatio: 0.5,
    breathPhaseMultiplier: 2,
    breathAmplitudeBase: 0.05,
    bloomDecay: 0.9,
    bloomScaleMultiplier: 3.0,
    bloomAlphaScale: 0.5,
    bloomCutoff: 0.01,
  }),
} as const satisfies PrismCoreTunables)
