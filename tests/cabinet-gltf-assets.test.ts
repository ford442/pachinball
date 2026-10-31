/**
 * Every glTF path a cabinet preset or insert points at must exist under
 * public/models/, parse as a GLB, stay inside the docs/CABINET_GLTF.md size
 * budget, and (for shells) roughly match the preset dimensions — so a boot
 * never 404s into the procedural fallback.
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('../src/game/game-utils', () => ({ resolveAssetUrl: (p: string) => p }))

import {
  CLASSIC_CONFIG,
  NEO_CONFIG,
  VERTICAL_CONFIG,
  WIDE_CONFIG,
} from '../src/cabinet/cabinet-presets'
import {
  MAG_SPIN_INSERT_GLTF,
  NANO_LOOM_INSERT_GLTF,
  PRISM_CORE_INSERT_GLTF,
} from '../src/cabinet/insert-gltf-loader'
import type { CabinetGltfConfig, CabinetPreset } from '../src/cabinet/cabinet-types'

const PUBLIC = join(__dirname, '../public')
const SIMPLE_BUDGET = 1.5 * 1024 * 1024
const HIGH_BUDGET = 8 * 1024 * 1024

interface GlbJson {
  nodes: { name: string; mesh?: number }[]
  accessors: { min?: number[]; max?: number[] }[]
  meshes: { primitives: { attributes: { POSITION: number } }[] }[]
}

function readGlbJson(path: string): GlbJson {
  const buf = readFileSync(path)
  expect(buf.readUInt32LE(0)).toBe(0x46546c67) // 'glTF'
  expect(buf.readUInt32LE(4)).toBe(2)
  expect(buf.readUInt32LE(8)).toBe(buf.byteLength)
  const jsonLen = buf.readUInt32LE(12)
  expect(buf.readUInt32LE(16)).toBe(0x4e4f534a) // 'JSON'
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GlbJson
}

function expectAssets(gltf: CabinetGltfConfig): void {
  for (const [url, budget] of [
    [gltf.simpleUrl, SIMPLE_BUDGET],
    [gltf.highUrl, HIGH_BUDGET],
  ] as const) {
    const path = join(PUBLIC, url)
    expect(existsSync(path), `${url} missing`).toBe(true)
    expect(statSync(path).size).toBeLessThanOrEqual(budget)
    expect(readGlbJson(path).nodes.length).toBeGreaterThan(0)
  }
}

const PRESETS: CabinetPreset[] = [CLASSIC_CONFIG, NEO_CONFIG, VERTICAL_CONFIG, WIDE_CONFIG]

describe('cabinet glTF assets on disk', () => {
  it.each(PRESETS.map((p) => [p.type, p] as const))('%s has a gltf block with both LODs', (_t, preset) => {
    expect(preset.gltf).toBeDefined()
    if (!preset.gltf) return
    expect(preset.gltf.simpleUrl).toBe(`models/cabinet/${preset.type}/simple.glb`)
    expect(preset.gltf.highUrl).toBe(`models/cabinet/${preset.type}/high.glb`)
    expect(preset.gltf.loadTimeoutMs).toBeGreaterThan(0)
    expectAssets(preset.gltf)
  })

  it.each(PRESETS.map((p) => [p.type, p] as const))('%s shell body matches the preset dims', (_t, preset) => {
    if (!preset.gltf) return
    const json = readGlbJson(join(PUBLIC, preset.gltf.simpleUrl))
    const body = json.nodes.find((n) => n.name === 'cabinetBody')
    expect(body?.mesh).toBeDefined()
    const prim = json.meshes[body?.mesh ?? 0]?.primitives[0]
    const acc = json.accessors[prim?.attributes.POSITION ?? 0]
    const min = acc?.min ?? []
    const max = acc?.max ?? []
    const extent = (i: number) => (max[i] ?? 0) - (min[i] ?? 0)
    // Same soft tolerance as assertCabinetAlignment (±4 units).
    expect(Math.abs(extent(0) - (preset.width + 4))).toBeLessThanOrEqual(4)
    expect(Math.abs(extent(1) - preset.sideHeight)).toBeLessThanOrEqual(6)
    expect(Math.abs(extent(2) - preset.depth)).toBeLessThanOrEqual(4)
  })

  it.each([
    ['prism-core', PRISM_CORE_INSERT_GLTF],
    ['mag-spin', MAG_SPIN_INSERT_GLTF],
    ['nano-loom', NANO_LOOM_INSERT_GLTF],
  ] as const)('insert %s has both LODs on disk', (_id, gltf) => {
    expectAssets(gltf)
  })
})
