export interface NanoLoomTunables {
  readonly kind: 'nano-loom'
  /** Intake capture trigger radius in world units. */
  readonly intakeRadius: number
  /** Post-EJECT re-entry gate in seconds. */
  readonly ejectCooldown: number
  readonly liftDuration: number
  readonly liftSpeed: number
  readonly loomPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly intakePosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly pinRows: number
  readonly pinCols: number
  readonly pinSpacing: number
  readonly pinBounciness: number
  readonly liftAlignLerpSpeed: number
  readonly weaveNudgeImpulse: number
  readonly ejectImpulse: { readonly x: number; readonly y: number; readonly z: number }
  readonly animation: {
    readonly liftTopYOffset: number
    readonly pinActivationRowRadius: number
    readonly pinActivationScaleBoost: number
    readonly pinActivationEmissiveBase: number
    readonly weaveExitMarginY: number
    readonly stateLightIdle: number
    readonly stateLightLift: number
  }
}

export const NANO_LOOM_TUNABLES = Object.freeze({
  kind: 'nano-loom',
  loomPosition: Object.freeze({ x: -13.0, y: 4.0, z: 2.0 }),
  intakePosition: Object.freeze({ x: -12.0, y: 0.5, z: 2.0 }),
  width: 2.0,
  height: 6.0,
  depth: 1.0,
  pinRows: 8,
  pinCols: 4,
  pinSpacing: 0.6,
  pinBounciness: 0.8,
  liftDuration: 1.5,
  intakeRadius: 1.5,
  liftSpeed: 10.0,
  liftAlignLerpSpeed: 5,
  weaveNudgeImpulse: 0.1,
  ejectImpulse: Object.freeze({ x: 8.0, y: 2.0, z: 0.0 }),
  ejectCooldown: 1.0,
  animation: Object.freeze({
    liftTopYOffset: 0.5,
    pinActivationRowRadius: 2,
    pinActivationScaleBoost: 0.5,
    pinActivationEmissiveBase: 0.5,
    weaveExitMarginY: 0.5,
    stateLightIdle: 0.2,
    stateLightLift: 1.0,
  }),
} as const satisfies NanoLoomTunables)
