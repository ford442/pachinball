import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseWasmFlagsFromCmake,
  formatWasmFlagsLine,
} from '../scripts/print-wasm-flags.mjs'

describe('print-wasm-flags', () => {
  it('parses SIMD/LTO/ENV/memory limits from CMakeLists.txt', () => {
    const cmake = readFileSync(join(process.cwd(), 'native/CMakeLists.txt'), 'utf8')
    const flags = parseWasmFlagsFromCmake(cmake)
    expect(flags.simd).toBe('ON')
    expect(flags.lto).toBe('ON')
    // The shipped bundle carries no Node shims (#442); build-wasm.sh adds
    // node only for the artefacts Node loads.
    expect(flags.env).toBe('web,worker')
    expect(flags.initialMemory).toBe('16777216')
    expect(flags.maximumMemory).toBe('268435456')
    expect(flags.stackSize).toBe('262144')
    expect(formatWasmFlagsLine(flags)).toBe(
      '[wasm-flags] SIMD=ON LTO=ON ENV=web,worker INITIAL_MEMORY=16777216 MAXIMUM_MEMORY=268435456 STACK_SIZE=262144'
    )
  })

  it('reads ENV from both the plain and the CACHE STRING form', () => {
    expect(parseWasmFlagsFromCmake('set(PACHINBALL_WASM_ENVIRONMENT "web,worker,node")').env).toBe(
      'web,worker,node'
    )
    expect(
      parseWasmFlagsFromCmake('set(PACHINBALL_WASM_ENVIRONMENT "web" CACHE STRING "doc text")').env
    ).toBe('web')
  })
})
