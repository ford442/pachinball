/**
 * PhysicsConfig — Centralized physics tunables extracted from game.ts monolith
 * All scalar values; Vector3 construction stays in implementation files.
 *
 * Intentionally separate from GameConfig.physics (known duplicate). Runtime
 * physics mostly uses PhysicsConfig; a few call sites still read GameConfig.physics.
 * Do not merge them in this pass — keep both and avoid further drift.
 */
export const PhysicsConfig = {
  global: {
    gravity: { x: 0, y: -9.81, z: -5.0 },
    spinTransferFactor: 0.35,
    spinDecayFactor: 0.12,
    englishSpinAmount: 0.08,
  },
  ball: {
    radius: 0.25,
    mass: 1.0,
    restitution: 0.76,
    friction: 0.14,
    linearDamping: 0.10,
    angularDamping: 0.18,
    resetImpulse: { x: 0, y: 0, z: 2.5 },
  },
  flipper: {
    stiffness: 32000,
    damping: 850,
    restAngleRad: Math.PI / 4,
    activeAngleRad: Math.PI / 8,
    kickVariation: 0.12,
    holdTimeDivisor: 0.28,
    kickImpulseScale: 2.8,
    leftLimits: [-Math.PI / 6, Math.PI / 4] as [number, number],
    rightLimits: [-Math.PI / 4, Math.PI / 6] as [number, number],
    restitution: 0.90,
    friction: 0.08,
  },
  bumper: {
    restitution: 0.94,
  },
  spinner: {
    targetSpeed: 18,
    acceleration: 32,
    deceleration: 9,
    hitFlashSeconds: 0.22,
  },
  trap: {
    holdDuration: 1.5,
    releaseBoost: 18,
    catchRestitution: 0.55,
  },
  plunger: {
    minImpulse: 14,
    maxImpulse: 36,
    maxChargeTimeMs: 1500,
    chargeCurveExponent: 1.25,
  },
  nudge: {
    force: 0.72,
    verticalBoost: 0.22,
    vectorLeft: { x: -0.6, y: 0, z: 0.3 },
    vectorRight: { x: 0.6, y: 0, z: 0.3 },
    vectorForward: { x: 0, y: 0, z: 0.8 },
  },
  input: {
    gamepadDeadZone: 0.15,
    nudgeThreshold: 0.5,
    nudgeDeltaThreshold: 0.2,
  },
  toys: {
    gateAmplitude: 2.0,
    gateSpeed: 1.5,
  },
} as const

export type PhysicsConfigType = typeof PhysicsConfig

/**
 * WASM Physics Engine feature flag configuration.
 * Reads from localStorage at runtime; defaults to wasm-owner.
 */
export const WASM_PHYSICS = {
  flagKey: 'pachinball:physics-engine',
  /** Production table physics; Rapier remains the missing-bundle / adventure path. */
  defaultEngine: 'wasm-owner',
  /**
   * Engine modes:
   *  - `rapier`       — Rapier only (explicit override or fail-closed fallback)
   *  - `wasm-mirror`  — WASM mirrors ball+bumper subset; Rapier bodies remain handles
   *  - `wasm-owner`   — WASM owns ball + static table + flipper hinges (in-process, production default)
   *  - `wasm-worker`  — same ownership as wasm-owner, C++ world in a Dedicated Worker
   *                     (`postMessage` snapshots, one-frame lag; no SAB / COOP+COEP yet)
   * Legacy `wasm` is treated as `wasm-mirror`.
   */
  allowedEngines: ['rapier', 'wasm', 'wasm-mirror', 'wasm-owner', 'wasm-worker'] as const,
  bundleUrl: './wasm/PhysicsModule.js',
  enabled: true,
  tunables: {
    fixedTimestep: 1 / 60,
    maxSubsteps: 8,
    solverIterations: 4,
    /** Rolling resistance applied at contacts after Coulomb friction. */
    rollingResistance: 0.04,
    groundPlane: { normal: { x: 0, y: 1, z: 0 }, distance: 0, friction: 0.18 },
  },
} as const

export type WasmPhysicsEnginePreference = (typeof WASM_PHYSICS.allowedEngines)[number]

/** Resolved runtime mode after normalising legacy flag values. */
export type WasmPhysicsRuntimeMode = 'rapier' | 'wasm-mirror' | 'wasm-owner' | 'wasm-worker'

export function getPhysicsEnginePreference(): WasmPhysicsEnginePreference {
  try {
    const v = localStorage.getItem(WASM_PHYSICS.flagKey)
    if (v === 'rapier') return 'rapier'
    if (v === 'wasm' || v === 'wasm-mirror') return 'wasm-mirror'
    if (v === 'wasm-owner') return 'wasm-owner'
    if (v === 'wasm-worker') return 'wasm-worker'
  } catch {
    // ignore localStorage errors (e.g. disabled storage)
  }
  return WASM_PHYSICS.defaultEngine as WasmPhysicsEnginePreference
}

/** Normalise localStorage values to the documented runtime modes. */
export function getWasmPhysicsRuntimeMode(): WasmPhysicsRuntimeMode {
  const pref = getPhysicsEnginePreference()
  if (pref === 'wasm-mirror' || pref === 'wasm') return 'wasm-mirror'
  if (pref === 'wasm-owner') return 'wasm-owner'
  if (pref === 'wasm-worker') return 'wasm-worker'
  return 'rapier'
}
