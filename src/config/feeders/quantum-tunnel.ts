export interface QuantumTunnelTunables {
  readonly kind: 'quantum-tunnel'
  /** Input portal sensor radius in world units. */
  readonly inputRadius: number
  /**
   * Scalar +X impulse applied to the ball on EJECT.
   * Exit velocity is derived as `new Vector3(ejectImpulse, 0, 0)` plus a random Z variance;
   * no spin or release-force phase exists (no CATCH→SPIN FSM for this feeder).
   */
  readonly ejectImpulse: number
  /** TRANSPORT hold duration in seconds (ball hidden off-table). */
  readonly transportDelay: number
  /** Post-EJECT ignore window in seconds. Invariant: >= transportDelay + capturePullDuration. */
  readonly cooldown: number
  /** Duration of the CAPTURE pull phase in seconds. */
  readonly capturePullDuration: number
  readonly capturePullLerpSpeed: number
  readonly ejectImpulseVarianceZ: number
  readonly ejectRecoilDistance: number
  /** Off-table Y used to hide the ball during TRANSPORT. */
  readonly transportHideY: number
  readonly cooldownFadeDuration: number
  readonly portalSpinIdle: number
  readonly portalSpinCapture: number
  readonly portalSpinTransport: number
  readonly portalSpinEject: number
  readonly inputPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly outputPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly animation: {
    readonly portalSpinLerpRate: number
    readonly outputSpinRatio: number
    readonly portalStretchAmplitude: number
    readonly portalStretchSideFactor: number
    readonly ejectRecoilDecay: number
    readonly ejectRecoilThreshold: number
    readonly idlePulseRate: number
    readonly idlePulseBase: number
    readonly idlePulseAmplitude: number
    readonly discEmissiveScale: number
  }
}

export const QUANTUM_TUNNEL_TUNABLES = Object.freeze({
  kind: 'quantum-tunnel',
  // Left upper wall — was on the right wall at the top of the plunger lane
  // and teleported nearly every launch. Eject still uses +X toward center.
  inputPosition: Object.freeze({ x: -11.5, y: 0.5, z: 14 }),
  outputPosition: Object.freeze({ x: -11.5, y: 0.5, z: 0.0 }),
  inputRadius: 1.2,
  ejectImpulse: 25.0,
  transportDelay: 0.5,
  cooldown: 2.0,
  capturePullDuration: 0.5,
  capturePullLerpSpeed: 10,
  ejectImpulseVarianceZ: 5.0,
  ejectRecoilDistance: 0.5,
  transportHideY: -100,
  cooldownFadeDuration: 1.0,
  portalSpinIdle: 1.0,
  portalSpinCapture: 5.0,
  portalSpinTransport: 8.0,
  portalSpinEject: 10.0,
  animation: Object.freeze({
    portalSpinLerpRate: 5.0,
    outputSpinRatio: 0.8,
    portalStretchAmplitude: 0.3,
    portalStretchSideFactor: 0.3,
    ejectRecoilDecay: 0.8,
    ejectRecoilThreshold: 0.01,
    idlePulseRate: 0.002,
    idlePulseBase: 0.5,
    idlePulseAmplitude: 0.2,
    discEmissiveScale: 0.8,
  }),
} as const satisfies QuantumTunnelTunables)
