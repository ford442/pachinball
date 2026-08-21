import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseWasmFlagsFromCmake,
  formatWasmFlagsLine,
} from '../scripts/print-wasm-flags.mjs'

describe('print-wasm-flags', () => {
  it('parses SIMD/LTO/ENV/INITIAL_MEMORY from CMakeLists.txt', () => {
    const cmake = readFileSync(join(process.cwd(), 'native/CMakeLists.txt'), 'utf8')
    const flags = parseWasmFlagsFromCmake(cmake)
    expect(flags.simd).toBe('ON')
    expect(flags.lto).toBe('ON')
    expect(flags.env).toBe('web,worker,node')
    expect(flags.initialMemory).toBe('16777216')
    expect(formatWasmFlagsLine(flags)).toBe(
      '[wasm-flags] SIMD=ON LTO=ON ENV=web,worker,node INITIAL_MEMORY=16777216'
    )
  })
})
