/**
 * Print effective WASM physics build flags from native/CMakeLists.txt.
 * Used by CI wasm_parity so logs always show SIMD/LTO/ENV/INITIAL_MEMORY.
 *
 * Usage: node scripts/print-wasm-flags.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { argv } from 'node:process'

const thisFile = fileURLToPath(import.meta.url)
const root = join(dirname(thisFile), '..')
const cmakePath = join(root, 'native', 'CMakeLists.txt')

/**
 * @param {string} cmakeText
 * @returns {{ simd: string, lto: string, env: string, initialMemory: string }}
 */
export function parseWasmFlagsFromCmake(cmakeText) {
  const simd = cmakeText.match(
    /option\(\s*PACHINBALL_WASM_SIMD\s+"[^"]*"\s+(ON|OFF)\s*\)/
  )
  const lto = cmakeText.match(
    /option\(\s*PACHINBALL_WASM_LTO\s+"[^"]*"\s+(ON|OFF)\s*\)/
  )
  const env = cmakeText.match(
    /set\(\s*PACHINBALL_WASM_ENVIRONMENT\s+"([^"]+)"\s*\)/
  )
  const mem = cmakeText.match(
    /set\(\s*PACHINBALL_WASM_INITIAL_MEMORY\s+(\d+)\s*\)/
  )
  return {
    simd: simd?.[1] ?? 'UNKNOWN',
    lto: lto?.[1] ?? 'UNKNOWN',
    env: env?.[1] ?? 'UNKNOWN',
    initialMemory: mem?.[1] ?? 'UNKNOWN',
  }
}

export function formatWasmFlagsLine(flags) {
  return `[wasm-flags] SIMD=${flags.simd} LTO=${flags.lto} ENV=${flags.env} INITIAL_MEMORY=${flags.initialMemory}`
}

const isMain = argv[1] !== undefined && resolve(argv[1]) === thisFile
if (isMain) {
  const cmakeText = readFileSync(cmakePath, 'utf8')
  const flags = parseWasmFlagsFromCmake(cmakeText)
  const line = formatWasmFlagsLine(flags)
  console.log(line)

  if (flags.simd === 'UNKNOWN' || flags.lto === 'UNKNOWN' || flags.env === 'UNKNOWN' || flags.initialMemory === 'UNKNOWN') {
    console.error(`[wasm-flags] Failed to parse ${cmakePath}`)
    process.exit(1)
  }
}
