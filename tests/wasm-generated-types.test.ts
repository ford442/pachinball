/**
 * The Embind enums as bindings.cpp declares them — read from the declarations
 * Emscripten generates (src/wasm/generated/PhysicsModule.d.ts, refreshed by
 * `npm run build:wasm`, diffed in CI) — against every hand-written TS mirror.
 * The method surface is checked at compile time by
 * src/wasm/wasm-types-conformance.ts.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BodyType, Shape } from '../src/wasm/wasm-types'
import { WasmBodyType, WasmForceSpace, WasmVolumeShape } from '../src/wasm/physics-module-adventure'

const dts = readFileSync(resolve(__dirname, '../src/wasm/generated/PhysicsModule.d.ts'), 'utf8')

/** `Name: {A: NameValue<0>, B: NameValue<1>};` from the generated EmbindModule. */
function generatedEnum(name: string): Record<string, number> {
  const body = dts.match(new RegExp(`\\b${name}: \\{([^}]*)\\};`))?.[1]
  if (!body) throw new Error(`enum ${name} not found in generated/PhysicsModule.d.ts`)
  return Object.fromEntries(
    [...body.matchAll(/(\w+): \w+Value<(\d+)>/g)].map(([, key, value]) => [key, Number(value)]),
  )
}

describe('generated Embind declarations', () => {
  it('BodyType mirrors match', () => {
    const generated = generatedEnum('BodyType')
    expect(generated).toEqual({ Dynamic: BodyType.Dynamic, Static: BodyType.Static, Kinematic: BodyType.Kinematic })
    expect(generated).toEqual({ ...WasmBodyType })
  })

  it('Shape mirror matches (Box included)', () => {
    expect(generatedEnum('Shape')).toEqual({ Sphere: Shape.Sphere, Capsule: Shape.Capsule, Box: Shape.Box })
  })

  it('VolumeShape and ForceSpace mirrors match', () => {
    expect(generatedEnum('VolumeShape')).toEqual({ ...WasmVolumeShape })
    expect(generatedEnum('ForceSpace')).toEqual({ ...WasmForceSpace })
  })

  it('u64 accessors are declared as bigint (lossless)', () => {
    for (const name of ['getStepCount', 'getStaticContentHash', 'getStateHash', 'getContactGeneration']) {
      expect(dts).toMatch(new RegExp(`\\b${name}\\(\\): bigint;`))
    }
  })
})
