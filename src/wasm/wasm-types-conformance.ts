/**
 * Compile-time drift check for the hand-written part of the world type.
 *
 * `WasmPhysicsWorldInstance` (wasm-types.ts) IS the declaration Emscripten
 * generates from bindings.cpp (generated/PhysicsModule.d.ts — refreshed by
 * `npm run build:wasm`, committed, diffed in CI), so a new binding needs no
 * second declaration. Only `WasmPhysicsWorldOverlay` and
 * `LegacyOptionalBinding` are written by hand; this file fails `tsc -b` when
 * one of them names a method that is no longer bound, or the overlay changes a
 * binding's arity or admits less than the binding returns.
 *
 * Type-only: nothing imports this file. The enum values are pinned at run
 * time by tests/wasm-generated-types.test.ts.
 */

import type { PhysicsWorld as GeneratedWorld } from './generated/PhysicsModule'
import type { LegacyOptionalBinding, WasmPhysicsWorldOverlay } from './wasm-types'

type Expect<T extends true> = T
type IsNever<T> = [T] extends [never] ? true : false
type IsAny<T> = 0 extends 1 & T ? true : false

/** String-literal keyed members (drops the index signature `[Symbol.dispose]` decays to). */
type Named<T> = { [K in keyof T]-?: K extends string ? (string extends K ? never : K) : never }[keyof T]

type Generated = Named<GeneratedWorld>
type Overlay = Named<WasmPhysicsWorldOverlay>

/** Overlay entries for methods bindings.cpp no longer binds. */
export type StaleInOverlay = Exclude<Overlay, Generated>
/** Legacy-optional names that are no longer bound. */
export type StaleLegacyOptional = Exclude<LegacyOptionalBinding, Generated>

type Shared = Overlay & Generated
type Fn<T, K extends keyof T> = Extract<Required<T>[K], (...args: never[]) => unknown>
type Arity<F> = F extends (...args: infer A) => unknown ? Required<A>['length'] : never

/** Same name, different number of parameters (optional ones count). */
export type ArityMismatch = {
  [K in Shared]: [Arity<Fn<GeneratedWorld, K>>] extends [Arity<Fn<WasmPhysicsWorldOverlay, K>>]
    ? [Arity<Fn<WasmPhysicsWorldOverlay, K>>] extends [Arity<Fn<GeneratedWorld, K>>]
      ? never
      : K
    : K
}[Shared]

/** The binding returns something the overlay does not admit (`any` / `val` returns skip). */
export type ReturnMismatch = {
  [K in Shared]: IsAny<ReturnType<Fn<GeneratedWorld, K>>> extends true
    ? never
    : [ReturnType<Fn<GeneratedWorld, K>>] extends [ReturnType<Fn<WasmPhysicsWorldOverlay, K>>]
      ? never
      : K
}[Shared]

export type WasmTypesConformance = [
  Expect<IsNever<StaleInOverlay>>,
  Expect<IsNever<StaleLegacyOptional>>,
  Expect<IsNever<ArityMismatch>>,
  Expect<IsNever<ReturnMismatch>>,
]
