/**
 * PhysicsConfig — Centralized physics tunables extracted from game.ts monolith
 * All scalar values; Vector3 construction stays in implementation files.
 *
 * Single source of truth for physics numbers. `GameConfig.physics` (the former
 * duplicate) has been removed; every surface constant below is defined once
 * and reused, so the Rapier and WASM (wasm-owner / wasm-mirror) paths cannot drift.
 */
const BUMPER_RESTITUTION = 0.94
const BUMPER_FRICTION = 0.05
const FLIPPER_RESTITUTION = 0.90
const FLIPPER_FRICTION = 0.08
const WALL_RESTITUTION = 0.82
const WALL_FRICTION = 0.15
const PLAYFIELD_RESTITUTION = 0.72
const PLAYFIELD_FRICTION = 0.18
const RAIL_RESTITUTION = 0.85
const RAIL_FRICTION = 0.08

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
    restitution: FLIPPER_RESTITUTION,
    friction: FLIPPER_FRICTION,
  },
  bumper: {
    restitution: BUMPER_RESTITUTION,
  },
  /** Per-surface restitution/friction pairs — the single source for both the Rapier and WASM physics paths. */
  surfaces: {
    bumper: { restitution: BUMPER_RESTITUTION, friction: BUMPER_FRICTION },
    flipper: { restitution: FLIPPER_RESTITUTION, friction: FLIPPER_FRICTION },
    wall: { restitution: WALL_RESTITUTION, friction: WALL_FRICTION },
    playfield: { restitution: PLAYFIELD_RESTITUTION, friction: PLAYFIELD_FRICTION },
    rail: { restitution: RAIL_RESTITUTION, friction: RAIL_FRICTION },
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
  /** Production physics (table + adventure); Rapier is imported only as the missing-bundle fallback. */
  defaultEngine: 'wasm-owner',
  /**
   * Engine modes:
   *  - `rapier`       — Rapier only: dev/degrade path (explicit override, or fail-closed when the WASM bundle is missing)
   *  - `wasm-mirror`  — WASM mirrors ball+bumper subset; Rapier stays authoritative and its bodies remain handles
   *  - `wasm-owner`   — WASM owns ball + static table + flipper hinges + adventure tracks (in-process, production default)
   *  - `wasm-worker`  — same ownership as wasm-owner (table + adventure tracks), C++ world
   *                     in a Dedicated Worker with one frame of lag. Snapshots come back over
   *                     a SharedArrayBuffer when `isCrossOriginIsolated()`, else as transferred
   *                     `postMessage` buffers (see docs/wasm-physics-engine.md, #414).
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

/**
 * Whether a runtime mode simulates on Rapier and so has to fetch it at boot:
 * the explicit `rapier` override and `wasm-mirror` (Rapier authoritative, C++
 * mirrors a subset). The owner modes never import Rapier unless the C++
 * bundle fails to load (#412).
 */
export function runtimeModeUsesRapier(mode: WasmPhysicsRuntimeMode): boolean {
  return !WASM_PHYSICS.enabled || mode === 'rapier' || mode === 'wasm-mirror'
}

/**
 * True when the page is cross-origin isolated (SharedArrayBuffer available).
 * Gates the `wasm-worker` snapshot transport: shared memory when true, transferred
 * `postMessage` buffers when false. Never gates whether the worker boots.
 */
export function isCrossOriginIsolated(): boolean {
  return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true
}
