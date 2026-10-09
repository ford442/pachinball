/**
 * Compile-time drift check: the hand-written Embind mirror in wasm-types.ts
 * against the declarations Emscripten generates from bindings.cpp
 * (generated/PhysicsModule.d.ts — refreshed by `npm run build:wasm`,
 * committed, and diffed in CI).
 *
 * Type-only: nothing imports this file. `tsc -b` fails here when a binding is
 * added, removed, renamed, changes arity or changes its return type without
 * `WasmPhysicsWorldInstance` following. The enum values are pinned at run
 * time by tests/wasm-generated-types.test.ts.
 */

import type { PhysicsWorld as GeneratedWorld } from './generated/PhysicsModule'
import type { WasmPhysicsWorldInstance } from './wasm-types'

type Expect<T extends true> = T
type IsNever<T> = [T] extends [never] ? true : false
type IsAny<T> = 0 extends 1 & T ? true : false

/** String-keyed callable members (embind's ClassHandle plumbing excluded). */
type Methods<T> = {
  [K in Extract<keyof T, string>]-?: Required<T>[K] extends (...args: never[]) => unknown ? K : never
}[Extract<keyof T, string>]
type HandlePlumbing = 'isAliasOf' | 'deleteLater' | 'isDeleted' | 'clone'

type Generated = Exclude<Methods<GeneratedWorld>, HandlePlumbing>
type Hand = Methods<WasmPhysicsWorldInstance>
type Shared = Generated & Hand

/** Bound in bindings.cpp but missing from `WasmPhysicsWorldInstance`. */
export type MissingFromWasmTypes = Exclude<Generated, Hand>
/** Declared on `WasmPhysicsWorldInstance` but no longer bound. */
export type StaleInWasmTypes = Exclude<Hand, Generated>

type Fn<T, K extends keyof T> = Extract<Required<T>[K], (...args: never[]) => unknown>
type Arity<F> = F extends (...args: infer A) => unknown ? Required<A>['length'] : never

/** Same name, different number of parameters (optional ones count). */
export type ArityMismatch = {
  [K in Shared]: [Arity<Fn<GeneratedWorld, K>>] extends [Arity<Fn<WasmPhysicsWorldInstance, K>>]
    ? [Arity<Fn<WasmPhysicsWorldInstance, K>>] extends [Arity<Fn<GeneratedWorld, K>>]
      ? never
      : K
    : K
}[Shared]

/** The binding returns something the hand-written type does not admit (`any` / `val` returns skip). */
export type ReturnMismatch = {
  [K in Shared]: IsAny<ReturnType<Fn<GeneratedWorld, K>>> extends true
    ? never
    : [ReturnType<Fn<GeneratedWorld, K>>] extends [ReturnType<Fn<WasmPhysicsWorldInstance, K>>]
      ? never
      : K
}[Shared]

export type WasmTypesConformance = [
  Expect<IsNever<MissingFromWasmTypes>>,
  Expect<IsNever<StaleInWasmTypes>>,
  Expect<IsNever<ArityMismatch>>,
  Expect<IsNever<ReturnMismatch>>,
]
